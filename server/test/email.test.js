import { test, before, after, beforeEach, describe } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import { startServer, stopServer, client, signIn, pool } from './helpers.js';
import { sendEmail, setTransport, verifyWebhook } from '../src/email.js';
import { TEMPLATES, renderEmail, maskEmail } from '../src/emailTemplates.js';

let call;
let base;
let sent;
before(async () => {
  ({ base } = await startServer());
  call = client(base);
});
after(stopServer);
beforeEach(async () => {
  sent = [];
  setTransport(async (msg) => {
    sent.push(msg);
    return `re_${crypto.randomUUID()}`;
  });
  await pool.query('TRUNCATE emails, email_suppressions');
});

const SECRET = process.env.RESEND_WEBHOOK_SECRET;
function signed(event, { secret = SECRET, ts = Math.floor(Date.now() / 1000) } = {}) {
  const body = JSON.stringify(event);
  const id = `msg_${crypto.randomUUID()}`;
  const key = Buffer.from(secret.replace(/^whsec_/, ''), 'base64');
  const sig = crypto.createHmac('sha256', key).update(`${id}.${ts}.${body}`).digest('base64');
  return { body, headers: { 'svix-id': id, 'svix-timestamp': String(ts), 'svix-signature': `v1,${sig}` } };
}

async function postWebhook(event, opts) {
  const { body, headers } = signed(event, opts);
  const res = await fetch(`${base}/webhooks/resend`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body,
  });
  return res.status;
}

const deleted = { template: 'account_deleted', data: { username: 'x' } };
const suppressedCount = async () =>
  Number((await pool.query('SELECT count(*) FROM email_suppressions')).rows[0].count);

describe('email templates', () => {
  test('every template renders a subject, HTML, and plain text with its link', () => {
    for (const [id, tpl] of Object.entries(TEMPLATES)) {
      const data = tpl.sample();
      const { subject, html, text } = renderEmail(id, data);
      assert.ok(subject.includes('MADEbyJIMBOB'), `${id} subject`);
      assert.match(html, /^<!doctype html>/);
      for (const url of Object.values(data).filter((v) => String(v).startsWith('http'))) {
        assert.ok(text.includes(url), `${id} text has ${url}`);
        assert.ok(html.includes(url), `${id} html has ${url}`);
      }
    }
  });

  test('escapes values from users', () => {
    const { html } = renderEmail('verify_email', { username: '<script>x</script>', url: 'https://x/"y' });
    assert.ok(!html.includes('<script>x'));
    assert.ok(html.includes('&lt;script&gt;'));
    assert.ok(html.includes('https://x/&quot;y'));
  });

  test('masks addresses', () => {
    assert.equal(maskEmail('jimbob@example.com'), 'ji***@example.com');
  });
});

describe('sendEmail', () => {
  test('sends through the transport and logs it', async () => {
    const data = TEMPLATES.reset_password.sample();
    const r = await sendEmail({ to: ' Fan@Example.com ', template: 'reset_password', data });
    assert.equal(r.status, 'sent');
    assert.equal(sent.length, 1);
    assert.equal(sent[0].to, 'fan@example.com');
    assert.equal(sent[0].template, 'reset_password');
    const { rows } = await pool.query('SELECT status, provider_id FROM emails');
    assert.equal(rows[0].status, 'sent');
    assert.match(rows[0].provider_id, /^re_/);
  });

  test('email off: nothing leaves the server', async () => {
    setTransport(null);
    assert.equal((await sendEmail({ to: 'fan@example.com', ...deleted })).status, 'off');
    assert.equal(sent.length, 0);
  });

  test('a failing provider is logged, not thrown', async () => {
    setTransport(async () => {
      throw new Error('provider down');
    });
    assert.equal((await sendEmail({ to: 'fan@example.com', ...deleted })).status, 'failed');
    const { rows } = await pool.query('SELECT status, error FROM emails');
    assert.deepEqual(rows[0], { status: 'failed', error: 'provider down' });
  });
});

describe('bounce and complaint webhook', () => {
  const bounce = (to, type = 'Permanent', emailId = 'e1') => ({
    type: 'email.bounced',
    data: { email_id: emailId, to: [to], bounce: { type, subType: 'General', message: 'No such mailbox' } },
  });

  test('a hard bounce stops all mail to that address', async () => {
    assert.equal(await postWebhook(bounce('Gone@Example.com')), 200);
    assert.equal((await sendEmail({ to: 'gone@example.com', ...deleted })).status, 'suppressed');
    assert.equal(sent.length, 0);
  });

  test('marks the logged email bounced; a transient bounce does not suppress', async () => {
    setTransport(async () => 'e-soft');
    await sendEmail({ to: 'full@example.com', ...deleted });
    assert.equal(await postWebhook(bounce('full@example.com', 'Transient', 'e-soft')), 200);
    const { rows } = await pool.query(`SELECT status FROM emails WHERE provider_id = 'e-soft'`);
    assert.equal(rows[0].status, 'bounced');
    assert.equal(await suppressedCount(), 0);
  });

  test('a spam complaint suppresses; receiving it twice is fine', async () => {
    const event = { type: 'email.complained', data: { email_id: 'e2', to: ['annoyed@example.com'] } };
    assert.equal(await postWebhook(event), 200);
    assert.equal(await postWebhook(event), 200);
    const { rows } = await pool.query('SELECT email, reason FROM email_suppressions');
    assert.deepEqual(rows, [{ email: 'annoyed@example.com', reason: 'complaint' }]);
  });

  test('rejects a wrong signature or an old timestamp', async () => {
    const other = `whsec_${Buffer.from('someone-else').toString('base64')}`;
    assert.equal(await postWebhook(bounce('x@example.com'), { secret: other }), 401);
    const old = Math.floor(Date.now() / 1000) - 600;
    assert.equal(await postWebhook(bounce('x@example.com'), { ts: old }), 401);
    assert.equal(await suppressedCount(), 0);
  });

  test('verifyWebhook rejects a changed body', () => {
    const { body, headers } = signed({ type: 'email.bounced' });
    assert.equal(verifyWebhook(Buffer.from(body), headers), true);
    assert.equal(verifyWebhook(Buffer.from(body.replace('bounced', 'opened')), headers), false);
  });
});

describe('Studio email', () => {
  test('admins preview templates and send a test; viewers cannot', async () => {
    const viewer = await signIn(call, 'mail_viewer');
    assert.equal((await call('/studio/email', { token: viewer })).status, 403);

    const admin = await signIn(call, 'test_admin');
    const info = await call('/studio/email', { token: admin });
    assert.equal(info.status, 200);
    assert.equal(info.data.templates.length, Object.keys(TEMPLATES).length);

    const preview = await call('/studio/email/preview/verify_email', { token: admin });
    assert.match(preview.data.html, /Confirm email/);
    assert.equal((await call('/studio/email/preview/constructor', { token: admin })).status, 404);

    const test = (to) =>
      call('/studio/email/test', { method: 'POST', token: admin, body: { to, template: 'verify_email' } });
    assert.equal((await test('nope')).status, 400);
    assert.deepEqual((await test('ruben@example.com')).data, { status: 'sent' });
    assert.ok(sent.some((m) => m.to === 'ruben@example.com' && m.template === 'verify_email'));

    const later = await call('/studio/email', { token: admin });
    assert.equal(later.data.recent[0].to, 'ru***@example.com');
  });
});
