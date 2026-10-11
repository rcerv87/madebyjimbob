import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, stopServer, client, signIn, seedVideo, pool } from './helpers.js';

let call;
let base;
let admin;
let member;
let videoId;
before(async () => {
  ({ base } = await startServer());
  call = client(base);
  videoId = await seedVideo();
  admin = await signIn(call, 'test_admin');
  member = await signIn(call, 'beta_tester');
});
after(stopServer);

const send = (body, token = member) => call('/feedback', { method: 'POST', token, body });
// A 1x1 PNG.
const PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

test('a member sends a note with where they were; Studio lists it and works through it', async () => {
  assert.equal((await call('/me')).data.options.feedback, true, 'on during the beta');
  assert.equal((await send({ note: 'hi' }, null)).status, 401);
  assert.equal((await send({ note: '   ' })).status, 400);

  const sent = await send({
    note: 'The chat jumped to the top when I replied.',
    page: `/watch/${videoId}?chat=all`,
    videoId,
    offsetMs: 754321.4,
    screen: '390x844 @3x',
  });
  assert.equal(sent.status, 200);

  assert.equal((await call('/studio/feedback', { token: member })).status, 403);
  const { feedback } = (await call('/studio/feedback', { token: admin })).data;
  assert.equal(feedback.length, 1);
  const f = feedback[0];
  assert.deepEqual(
    [f.username, f.note, f.page, String(f.videoId), f.offsetMs, f.screen, f.status, f.hasScreenshot],
    [
      'beta_tester',
      'The chat jumped to the top when I replied.',
      `/watch/${videoId}?chat=all`,
      String(videoId),
      754321,
      '390x844 @3x',
      'new',
      false,
    ],
  );
  assert.ok(f.videoTitle);
  assert.equal((await call('/studio/overview', { token: admin })).data.attention.newFeedback, 1);

  const mark = (status) =>
    call(`/studio/feedback/${f.id}`, { method: 'POST', token: admin, body: { status } });
  assert.equal((await mark('archived')).status, 400);
  assert.equal((await mark('seen')).status, 200);
  assert.equal((await call('/studio/feedback', { token: admin })).data.feedback.length, 0);
  assert.equal((await call('/studio/feedback?status=seen', { token: admin })).data.feedback.length, 1);
  assert.equal((await mark('done')).status, 200);
  assert.equal((await call('/studio/overview', { token: admin })).data.attention.newFeedback, 0);
  assert.equal(
    (await call('/studio/feedback/999999', { method: 'POST', token: admin, body: { status: 'done' } }))
      .status,
    404,
  );
});

test('a screenshot is kept and only Studio accounts can open it, as a picture', async () => {
  assert.equal((await send({ note: 'x', screenshot: 'data:text/html;base64,PGI+' })).status, 400);
  assert.equal((await send({ note: 'x', screenshot: 'not a picture' })).status, 400);
  const big = `data:image/png;base64,${Buffer.alloc(2 * 1024 * 1024 + 10).toString('base64')}`;
  assert.equal((await send({ note: 'x', screenshot: big })).status, 400, 'over 2 MB');

  const ok = await send({ note: 'Button is cut off', page: '/shop', screenshot: PNG });
  assert.equal(ok.status, 200);
  const url = `${base}/studio/feedback/${ok.data.id}/screenshot`;
  assert.equal((await fetch(url)).status, 401);
  assert.equal((await fetch(url, { headers: { Authorization: `Bearer ${member}` } })).status, 403);
  const res = await fetch(url, { headers: { Authorization: `Bearer ${admin}` } });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'image/png');
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  assert.match(res.headers.get('content-security-policy'), /sandbox/);
  assert.equal(Buffer.from(await res.arrayBuffer()).length, 70);
  const listed = (await call('/studio/feedback', { token: admin })).data.feedback;
  assert.equal(listed.find((f) => f.id === ok.data.id).hasScreenshot, true);
});

test('feedback is in the member’s data download, is limited per day, and closes with FEEDBACK=off', async () => {
  const data = (await call('/account/export', { token: member })).data;
  assert.ok(data.feedback.some((f) => f.note === 'Button is cut off' && f.had_screenshot === true));

  await pool.query(
    `INSERT INTO feedback (user_id, note) SELECT (SELECT id FROM users WHERE username = 'beta_tester'), 'bulk'
     FROM generate_series(1, 30)`,
  );
  assert.equal((await send({ note: 'one more' })).status, 409);

  process.env.FEEDBACK = 'off';
  try {
    assert.equal((await call('/me')).data.options.feedback, false);
    assert.equal((await send({ note: 'after the beta' }, admin)).status, 404);
  } finally {
    delete process.env.FEEDBACK;
  }
});
