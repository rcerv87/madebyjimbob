import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, stopServer, client, seedVideo, seedChat, signIn, sleep, pool } from './helpers.js';

let call;
let apiBase;
before(async () => {
  const { base } = await startServer();
  apiBase = base;
  call = client(base);
});
after(stopServer);

describe('video access', () => {
  test('bad and unknown ids return 404 JSON', async () => {
    assert.equal((await call('/videos/abc')).status, 404);
    assert.equal((await call('/videos/999999')).status, 404);
    assert.equal((await call('/videos/1;DROP')).status, 404);
    assert.equal((await call('/videos/999999/view', { method: 'POST' })).status, 404);
    const unknown = await call('/does-not-exist');
    assert.equal(unknown.status, 404);
    assert.match(unknown.data.error, /Unknown API endpoint/);
  });

  test('premium video is locked below premium and open at premium', async () => {
    const id = await seedVideo({ minTier: 'premium' });
    const anon = await call(`/videos/${id}`);
    assert.equal(anon.data.video.locked, true);
    assert.equal(anon.data.video.hls, null);
    const free = await call(`/videos/${id}`, { token: await signIn(call, 'free_viewer') });
    assert.equal(free.data.video.locked, true);
    const prem = await call(`/videos/${id}`, { token: await signIn(call, 'prem_viewer', 'premium') });
    assert.equal(prem.data.video.locked, false);
  });
});

describe('chat window', () => {
  test('returns visible messages in [from, to) ordered by offset', async () => {
    const id = await seedVideo();
    await seedChat(id, [
      { body: 'late', offsetMs: 90_000 },
      { body: 'early', offsetMs: 1_000 },
      { body: 'hidden', offsetMs: 2_000, hidden: true },
      { body: 'edge', offsetMs: 120_000 },
    ]);
    const r = await call(`/videos/${id}/chat?from=0&to=120000`);
    assert.equal(r.status, 200);
    assert.deepEqual(
      r.data.messages.map((m) => m.body),
      ['early', 'late'],
    );
    const next = await call(`/videos/${id}/chat?from=120000&to=240000`);
    assert.deepEqual(
      next.data.messages.map((m) => m.body),
      ['edge'],
    );
  });

  test('afterId returns everything newer than a message, for reconnect catch-up', async () => {
    const id = await seedVideo();
    await seedChat(id, [
      { body: 'old', offsetMs: 500_000 },
      { body: 'newer', offsetMs: 1_000 },
      { body: 'hidden', offsetMs: 2_000, hidden: true },
      { body: 'newest', offsetMs: 300_000 },
    ]);
    const all = await call(`/videos/${id}/chat?from=0&to=600000`);
    const oldId = all.data.messages.find((m) => m.body === 'old').id;
    const r = await call(`/videos/${id}/chat?afterId=${oldId}`);
    assert.deepEqual(
      r.data.messages.map((m) => m.body),
      ['newer', 'newest'],
    );
    assert.equal((await call(`/videos/${id}/chat?afterId=abc`)).status, 400);
    const locked = await seedVideo({ minTier: 'premium' });
    assert.equal((await call(`/videos/${locked}/chat?afterId=0`)).status, 403);
  });

  test('is blocked for viewers below the video tier', async () => {
    const id = await seedVideo({ minTier: 'plus' });
    await seedChat(id, [{ body: 'members only', offsetMs: 1_000 }]);
    assert.equal((await call(`/videos/${id}/chat`)).status, 403);
    assert.equal(
      (await call(`/videos/${id}/chat`, { token: await signIn(call, 'free_reader') })).status,
      403,
    );
    const plus = await call(`/videos/${id}/chat`, { token: await signIn(call, 'plus_reader', 'plus') });
    assert.equal(plus.data.messages[0].body, 'members only');
  });
});

describe('chat posting', () => {
  test('requires sign-in and the right tier', async () => {
    const id = await seedVideo({ minTier: 'premium' });
    assert.equal((await call(`/videos/${id}/chat`, { method: 'POST', body: { text: 'hi' } })).status, 401);
    const token = await signIn(call, 'free_poster');
    assert.equal(
      (await call(`/videos/${id}/chat`, { method: 'POST', token, body: { text: 'hi' } })).status,
      403,
    );
    assert.equal(
      (await call('/videos/999999/chat', { method: 'POST', token, body: { text: 'hi' } })).status,
      404,
    );
  });

  test('stores the message with mentions, masking, and a clamped offset', async () => {
    const id = await seedVideo({ durationS: 600 });
    const token = await signIn(call, 'poster');
    const r = await call(`/videos/${id}/chat`, {
      method: 'POST',
      token,
      body: { text: '  hey   @JimBob  badword ', offsetMs: 1e13 },
    });
    assert.equal(r.status, 200);
    assert.equal(r.data.message.body, 'hey @JimBob *******');
    assert.deepEqual(r.data.message.mentions, ['jimbob']);
    assert.equal(r.data.message.offsetMs, 600_000);
    assert.equal(r.data.message.source, 'native');
  });

  test('rejects empty messages', async () => {
    const id = await seedVideo();
    const token = await signIn(call, 'empty_poster');
    assert.equal(
      (await call(`/videos/${id}/chat`, { method: 'POST', token, body: { text: '   ' } })).status,
      400,
    );
  });

  test('rate limits to one message per 1.5s, even for parallel requests', async () => {
    const id = await seedVideo();
    const token = await signIn(call, 'fast_poster');
    const post = () =>
      call(`/videos/${id}/chat`, { method: 'POST', token, body: { text: 'spam', offsetMs: 0 } });
    const burst = await Promise.all([post(), post(), post()]);
    assert.deepEqual(burst.map((r) => r.status).sort(), [200, 429, 429]);
    await sleep(1600);
    assert.equal((await post()).status, 200);
  });
});

describe('studio', () => {
  test('is admin-only', async () => {
    assert.equal((await call('/studio/overview')).status, 401);
    const viewer = await signIn(call, 'studio_viewer', 'premium');
    assert.equal((await call('/studio/overview', { token: viewer })).status, 403);
    assert.equal(
      (await call('/studio/videos/1', { method: 'PATCH', token: viewer, body: { minTier: 'free' } })).status,
      403,
    );
  });

  test('admin sees totals and can change a video tier', async () => {
    const admin = await signIn(call, 'test_admin');
    const id = await seedVideo();
    const overview = await call('/studio/overview', { token: admin });
    assert.equal(overview.status, 200);
    assert.ok(overview.data.totals.videos >= 1);
    const bad = await call(`/studio/videos/${id}`, {
      method: 'PATCH',
      token: admin,
      body: { minTier: 'gold' },
    });
    assert.equal(bad.status, 400);
    const ok = await call(`/studio/videos/${id}`, {
      method: 'PATCH',
      token: admin,
      body: { minTier: 'plus' },
    });
    assert.equal(ok.status, 200);
    assert.equal((await call(`/videos/${id}`)).data.video.minTier, 'plus');
  });
});

describe('request handling', () => {
  test('every response carries a request id, reusing a safe incoming one', async () => {
    const fresh = await fetch(`${apiBase}/health`);
    assert.match(fresh.headers.get('x-request-id'), /^[0-9a-f-]{36}$/);
    const given = await fetch(`${apiBase}/health`, { headers: { 'X-Request-Id': 'trace-123' } });
    assert.equal(given.headers.get('x-request-id'), 'trace-123');
    const unsafe = await fetch(`${apiBase}/health`, { headers: { 'X-Request-Id': 'bad id <script>' } });
    assert.notEqual(unsafe.headers.get('x-request-id'), 'bad id <script>');
  });

  test('malformed JSON is a 400, not a server error', async () => {
    const res = await fetch(`${apiBase}/session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{"username": ',
    });
    assert.equal(res.status, 400);
    assert.match((await res.json()).error, /valid JSON/);
  });

  test('oversized bodies are a 413', async () => {
    const res = await fetch(`${apiBase}/session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'x'.repeat(60_000) }),
    });
    assert.equal(res.status, 413);
  });
});

describe('comments', () => {
  async function seedComment(videoId, { ext, parent = null, body, likes = 0, pinned = false, hoursAgo = 1 }) {
    const { rows } = await pool.query(
      `INSERT INTO comments (video_id, source, external_id, parent_id, author_name, body, like_count, pinned, posted_at)
       VALUES ($1, 'youtube', $2, $3, '@Viewer', $4, $5, $6, now() - make_interval(hours => $7)) RETURNING id`,
      [videoId, ext, parent, body, likes, pinned, hoursAgo],
    );
    return rows[0].id;
  }

  test('lists threads by top (pinned first, then likes) or newest, with replies nested', async () => {
    const id = await seedVideo();
    const popular = await seedComment(id, { ext: 'c-pop', body: 'popular', likes: 50, hoursAgo: 5 });
    await seedComment(id, { ext: 'c-new', body: 'newest', likes: 1, hoursAgo: 1 });
    await seedComment(id, { ext: 'c-pin', body: 'pinned', likes: 0, pinned: true, hoursAgo: 9 });
    await seedComment(id, { ext: 'c-r1', parent: popular, body: 'first reply', hoursAgo: 4 });
    await seedComment(id, { ext: 'c-r2', parent: popular, body: 'second reply', hoursAgo: 2 });

    const top = await call(`/videos/${id}/comments`);
    assert.equal(top.status, 200);
    assert.equal(top.data.total, 5);
    assert.deepEqual(
      top.data.comments.map((c) => c.body),
      ['pinned', 'popular', 'newest'],
    );
    assert.deepEqual(
      top.data.comments[1].replies.map((r) => r.body),
      ['first reply', 'second reply'],
    );
    assert.equal(top.data.nextOffset, null);

    const newest = await call(`/videos/${id}/comments?sort=new`);
    assert.deepEqual(
      newest.data.comments.map((c) => c.body),
      ['newest', 'popular', 'pinned'],
    );
  });

  test('pages 20 threads at a time', async () => {
    const id = await seedVideo();
    for (let i = 0; i < 25; i++) await seedComment(id, { ext: `page-${id}-${i}`, body: `c${i}`, likes: i });
    const first = await call(`/videos/${id}/comments`);
    assert.equal(first.data.comments.length, 20);
    assert.equal(first.data.nextOffset, 20);
    const second = await call(`/videos/${id}/comments?offset=20`);
    assert.equal(second.data.comments.length, 5);
    assert.equal(second.data.nextOffset, null);
  });

  test('are gated by the video tier', async () => {
    const id = await seedVideo({ minTier: 'plus' });
    assert.equal((await call(`/videos/${id}/comments`)).status, 403);
    const free = await signIn(call, 'comment_free');
    assert.equal(
      (await call(`/videos/${id}/comments`, { method: 'POST', token: free, body: { text: 'hi' } })).status,
      403,
    );
    const plus = await signIn(call, 'comment_plus', 'plus');
    assert.equal((await call(`/videos/${id}/comments`, { token: plus })).status, 200);
  });

  test('members post comments and replies; line breaks kept, banned words masked', async () => {
    const id = await seedVideo();
    const token = await signIn(call, 'commenter');
    assert.equal((await call(`/videos/${id}/comments`, { method: 'POST', body: { text: 'x' } })).status, 401);
    assert.equal(
      (await call(`/videos/${id}/comments`, { method: 'POST', token, body: { text: '  ' } })).status,
      400,
    );

    const posted = await call(`/videos/${id}/comments`, {
      method: 'POST',
      token,
      body: { text: 'Line one\r\n\r\n\r\n\r\nline   two badword' },
    });
    assert.equal(posted.status, 200);
    assert.equal(posted.data.comment.body, 'Line one\n\nline two *******');
    assert.equal(posted.data.comment.source, 'native');
    assert.equal(posted.data.comment.author, 'commenter');

    await sleep(5100);
    const reply = await call(`/videos/${id}/comments`, {
      method: 'POST',
      token,
      body: { text: 'a reply', parentId: posted.data.comment.id },
    });
    assert.equal(reply.status, 200);
    assert.equal(reply.data.comment.parentId, posted.data.comment.id);

    const list = await call(`/videos/${id}/comments`);
    assert.equal(list.data.comments[0].replies[0].body, 'a reply');
  });

  test('replies must target a comment on the same video (a reply to a reply stays in its thread)', async () => {
    const id = await seedVideo();
    const other = await seedVideo();
    const parent = await seedComment(id, { ext: `rt-${id}`, body: 'parent' });
    const child = await seedComment(id, { ext: `rt-${id}-c`, parent, body: 'child' });
    const elsewhere = await seedComment(other, { ext: `rt-${other}`, body: 'other video' });
    for (const [i, replyToId] of [elsewhere, 'abc', 999999].entries()) {
      const token = await signIn(call, `replier_${i}`);
      const r = await call(`/videos/${id}/comments`, {
        method: 'POST',
        token,
        body: { text: 'x', replyToId },
      });
      assert.equal(r.status, 400, `replyToId ${replyToId}`);
    }
    const token = await signIn(call, 'replier_ok');
    const ok = await call(`/videos/${id}/comments`, {
      method: 'POST',
      token,
      body: { text: 'x', replyToId: child },
    });
    assert.equal(ok.status, 200);
    assert.equal(ok.data.comment.parentId, parent);
    assert.equal(ok.data.comment.replyTo.id, child);
  });

  test('rate limits comments to one per 5 seconds', async () => {
    const id = await seedVideo();
    const token = await signIn(call, 'fast_commenter');
    const post = () => call(`/videos/${id}/comments`, { method: 'POST', token, body: { text: 'hello' } });
    const burst = await Promise.all([post(), post()]);
    assert.deepEqual(burst.map((r) => r.status).sort(), [200, 429]);
  });
});

describe('conversation: replies, replay chat, timestamped comments', () => {
  test('replay chat is marked, and replies quote the exact message they answer', async () => {
    const id = await seedVideo();
    await seedChat(id, [{ body: 'original live message', offsetMs: 10_000 }]);
    const window = await call(`/videos/${id}/chat?from=0&to=120000`);
    const live = window.data.messages[0];
    assert.equal(live.postedLive, true);

    const token = await signIn(call, 'chat_replier');
    const reply = await call(`/videos/${id}/chat`, {
      method: 'POST',
      token,
      body: { text: '@Viewer good point', offsetMs: 15_000, replyToId: live.id },
    });
    assert.equal(reply.status, 200);
    assert.equal(reply.data.message.postedLive, false);
    assert.deepEqual(reply.data.message.replyTo, {
      id: live.id,
      author: 'Viewer',
      body: 'original live message',
      offsetMs: 10_000,
    });

    const again = await call(`/videos/${id}/chat?from=0&to=120000`);
    assert.equal(again.data.messages[1].replyTo.id, live.id);
  });

  test('chat replies must target a message on the same video', async () => {
    const id = await seedVideo();
    const other = await seedVideo();
    await seedChat(other, [{ body: 'elsewhere', offsetMs: 0 }]);
    const elsewhere = (await call(`/videos/${other}/chat?from=0&to=120000`)).data.messages[0];
    for (const [i, replyToId] of [elsewhere.id, 'abc', 999999].entries()) {
      const token = await signIn(call, `bad_chat_reply_${i}`);
      const r = await call(`/videos/${id}/chat`, { method: 'POST', token, body: { text: 'x', replyToId } });
      assert.equal(r.status, 400, `replyToId ${replyToId}`);
    }
  });

  test('timestamped comments show up in the chat window at their moment', async () => {
    const id = await seedVideo({ durationS: 600 });
    const token = await signIn(call, 'stamp_commenter');
    const c = await call(`/videos/${id}/comments`, {
      method: 'POST',
      token,
      body: { text: 'this part right here', offsetMs: 65_000 },
    });
    assert.equal(c.status, 200);
    assert.equal(c.data.comment.offsetMs, 65_000);

    const inWindow = await call(`/videos/${id}/chat?from=0&to=120000`);
    assert.deepEqual(
      inWindow.data.comments.map((x) => x.body),
      ['this part right here'],
    );
    const outside = await call(`/videos/${id}/chat?from=120000&to=240000`);
    assert.deepEqual(outside.data.comments, []);

    await sleep(5100);
    const clamped = await call(`/videos/${id}/comments`, {
      method: 'POST',
      token,
      body: { text: 'way past the end', offsetMs: 9_999_999 },
    });
    assert.equal(clamped.data.comment.offsetMs, 600_000);
    const bad = await call(`/videos/${id}/comments`, {
      method: 'POST',
      token,
      body: { text: 'x', offsetMs: -5 },
    });
    assert.equal(bad.status, 400);
  });

  test('any comment opens its whole thread', async () => {
    const id = await seedVideo();
    const other = await seedVideo();
    const a = await signIn(call, 'opener_a');
    const top = (await call(`/videos/${id}/comments`, { method: 'POST', token: a, body: { text: 'topic' } }))
      .data.comment;
    const b = await signIn(call, 'opener_b');
    const reply = (
      await call(`/videos/${id}/comments`, {
        method: 'POST',
        token: b,
        body: { text: 'answer', replyToId: top.id },
      })
    ).data.comment;
    for (const cid of [top.id, reply.id]) {
      const t = await call(`/videos/${id}/comments/${cid}`);
      assert.equal(t.status, 200);
      assert.equal(t.data.comment.id, top.id);
      assert.deepEqual(
        t.data.comment.replies.map((r) => r.body),
        ['answer'],
      );
    }
    assert.equal((await call(`/videos/${other}/comments/${top.id}`)).status, 404, 'other video');
    assert.equal((await call(`/videos/${id}/comments/abc`)).status, 404);
  });

  test('replying to a reply joins the same thread and quotes the reply', async () => {
    const id = await seedVideo();
    const a = await signIn(call, 'thread_a');
    const b = await signIn(call, 'thread_b');
    const top = (
      await call(`/videos/${id}/comments`, { method: 'POST', token: a, body: { text: 'first point' } })
    ).data.comment;
    const r1 = (
      await call(`/videos/${id}/comments`, {
        method: 'POST',
        token: b,
        body: { text: 'disagree', replyToId: top.id },
      })
    ).data.comment;
    await sleep(5100);
    const r2 = (
      await call(`/videos/${id}/comments`, {
        method: 'POST',
        token: a,
        body: { text: 'why?', replyToId: r1.id },
      })
    ).data.comment;
    assert.equal(r2.parentId, top.id, 'stays in the top-level thread');
    assert.equal(r2.replyTo.id, r1.id);
    assert.equal(r2.replyTo.body, 'disagree');

    const list = await call(`/videos/${id}/comments`);
    const thread = list.data.comments.find((x) => x.id === top.id);
    assert.equal(thread.replyCount, 2);
    assert.equal(thread.replies[1].replyTo.author, 'thread_b');
  });
});

describe('watch progress', () => {
  test('signed-in viewers resume where they stopped, on the video and in the list', async () => {
    const id = await seedVideo({ durationS: 600 });
    const token = await signIn(call, 'resumer');
    assert.equal((await call(`/videos/${id}`, { token })).data.video.resumeMs, null);

    const saved = await call(`/videos/${id}/progress`, {
      method: 'PUT',
      token,
      body: { positionMs: 125_400 },
    });
    assert.equal(saved.status, 200);
    assert.equal((await call(`/videos/${id}`, { token })).data.video.resumeMs, 125_400);
    const card = (await call('/videos', { token })).data.videos.find((v) => v.id === id);
    assert.equal(card.progressMs, 125_400);

    const other = await signIn(call, 'someone_else');
    assert.equal((await call(`/videos/${id}`, { token: other })).data.video.resumeMs, null, 'per viewer');
    assert.equal((await call(`/videos/${id}`)).data.video.resumeMs, null, 'signed out');
  });

  test('clamps to the video length and rejects bad input', async () => {
    const id = await seedVideo({ durationS: 600 });
    const token = await signIn(call, 'resumer_2');
    const r = await call(`/videos/${id}/progress`, { method: 'PUT', token, body: { positionMs: 9e9 } });
    assert.equal(r.data.positionMs, 600_000);
    assert.equal(
      (await call(`/videos/${id}/progress`, { method: 'PUT', token, body: { positionMs: -1 } })).status,
      400,
    );
    assert.equal(
      (await call(`/videos/${id}/progress`, { method: 'PUT', body: { positionMs: 5 } })).status,
      401,
    );
    assert.equal(
      (await call('/videos/999999/progress', { method: 'PUT', token, body: { positionMs: 5 } })).status,
      404,
    );
  });
});

describe('video likes', () => {
  test('signed-in viewers like, switch to dislike, and clear; viewers see likes only', async () => {
    const id = await seedVideo();
    const a = await signIn(call, 'liker_a');
    const b = await signIn(call, 'liker_b');
    assert.equal((await call(`/videos/${id}`, { token: a })).data.video.likes, 0);

    let r = await call(`/videos/${id}/vote`, { method: 'POST', token: a, body: { value: 1 } });
    assert.deepEqual(r.data, { likes: 1, myVote: 1 });
    await call(`/videos/${id}/vote`, { method: 'POST', token: b, body: { value: 1 } });
    r = await call(`/videos/${id}/vote`, { method: 'POST', token: a, body: { value: -1 } });
    assert.deepEqual(r.data, { likes: 1, myVote: -1 });

    const seen = (await call(`/videos/${id}`, { token: b })).data.video;
    assert.equal(seen.likes, 1);
    assert.equal(seen.myVote, 1);
    assert.equal(seen.dislikes, undefined, 'dislikes are not public');

    r = await call(`/videos/${id}/vote`, { method: 'POST', token: a, body: { value: 0 } });
    assert.deepEqual(r.data, { likes: 1, myVote: 0 });

    const admin = await signIn(call, 'test_admin');
    const row = (await call('/studio/overview', { token: admin })).data.videos.find((v) => v.id === id);
    assert.deepEqual({ likes: row.likes, dislikes: row.dislikes }, { likes: 1, dislikes: 0 });
  });

  test('needs sign-in, a valid value, and access to the video', async () => {
    const id = await seedVideo();
    assert.equal((await call(`/videos/${id}/vote`, { method: 'POST', body: { value: 1 } })).status, 401);
    const token = await signIn(call, 'liker_c');
    assert.equal(
      (await call(`/videos/${id}/vote`, { method: 'POST', token, body: { value: 5 } })).status,
      400,
    );
    const members = await seedVideo({ minTier: 'plus' });
    assert.equal(
      (await call(`/videos/${members}/vote`, { method: 'POST', token, body: { value: 1 } })).status,
      403,
    );
  });
});

describe('input checks', () => {
  test('tier changes take only real tiers, and unknown videos are 404', async () => {
    const admin = await signIn(call, 'test_admin');
    const id = await seedVideo();
    for (const minTier of ['constructor', 'toString', ['plus'], null]) {
      const r = await call(`/studio/videos/${id}`, { method: 'PATCH', token: admin, body: { minTier } });
      assert.equal(r.status, 400, `minTier ${JSON.stringify(minTier)}`);
    }
    for (const bad of ['999999', 'abc']) {
      const r = await call(`/studio/videos/${bad}`, {
        method: 'PATCH',
        token: admin,
        body: { minTier: 'plus' },
      });
      assert.equal(r.status, 404);
    }
    assert.equal((await call('/videos/abc/view', { method: 'POST' })).status, 404);
  });

  test('chat and comment text that is not a string counts as empty', async () => {
    const token = await signIn(call, 'odd_texter');
    const id = await seedVideo();
    const chat = await call(`/videos/${id}/chat`, { method: 'POST', token, body: { text: { a: 1 } } });
    assert.equal(chat.status, 400);
    const comment = await call(`/videos/${id}/comments`, { method: 'POST', token, body: { text: ['hi'] } });
    assert.equal(comment.status, 400);
  });

  test('Studio totals add up the videos and leave hidden chat out', async () => {
    const admin = await signIn(call, 'test_admin');
    const id = await seedVideo();
    await seedChat(id, [
      { body: 'one', offsetMs: 1_000 },
      { body: 'two', offsetMs: 2_000 },
      { body: 'gone', offsetMs: 3_000, hidden: true },
    ]);
    const { data } = await call('/studio/overview', { token: admin });
    assert.equal(data.videos.find((v) => v.id === id).youtubeMsgs, 2);
    const sum = (key) => data.videos.reduce((n, v) => n + v[key], 0);
    assert.equal(data.totals.videos, data.videos.length);
    assert.equal(data.totals.views, sum('views'));
    assert.equal(data.totals.youtubeMsgs, sum('youtubeMsgs'));
    assert.equal(data.totals.nativeMsgs, sum('nativeMsgs'));
    assert.ok(data.totals.chatters >= 1);
  });
});
