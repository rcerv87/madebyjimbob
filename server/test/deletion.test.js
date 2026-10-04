import { test, before, after, beforeEach, describe } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import { startServer, stopServer, client, signIn, emailFor, seedVideo, pool } from './helpers.js';
import { setTransport } from '../src/email.js';
import { eraseDueAccounts } from '../src/deletion.js';

let call;
let base;
let sent;
let videoId;
before(async () => {
  ({ base } = await startServer());
  call = client(base);
  videoId = await seedVideo();
});
after(stopServer);
beforeEach(() => {
  sent = [];
  setTransport(async (msg) => {
    sent.push(msg);
    return `re_${crypto.randomUUID()}`;
  });
});

const me = async (token) => (await call('/me', { token })).data.user;
const userRow = async (name) =>
  (
    await pool.query('SELECT id, deletion_requested_at, delete_content FROM users WHERE username = $1', [
      name,
    ])
  ).rows[0];
const backdate = (name, days) =>
  pool.query(
    `UPDATE users SET deletion_requested_at = now() - make_interval(days => $2) WHERE username = $1`,
    [name, days],
  );

// A member with a chat message, a comment, a like, and saved progress; plus someone who replied to them.
async function memberWithContent(name) {
  const token = await signIn(call, name);
  const chat = await call(`/videos/${videoId}/chat`, {
    method: 'POST',
    token,
    body: { text: `chat from ${name}`, offsetMs: 5000 },
  });
  const comment = await call(`/videos/${videoId}/comments`, {
    method: 'POST',
    token,
    body: { text: `comment from ${name}` },
  });
  await call(`/videos/${videoId}/vote`, { method: 'POST', token, body: { value: 1 } });
  await call(`/videos/${videoId}/progress`, { method: 'PUT', token, body: { positionMs: 42_000 } });
  const other = await signIn(call, `${name}_friend`);
  const reply = await call(`/videos/${videoId}/comments`, {
    method: 'POST',
    token: other,
    body: { text: 'nice point', replyToId: comment.data.comment.id },
  });
  return {
    token,
    chatId: chat.data.message.id,
    commentId: comment.data.comment.id,
    replyId: reply.data.comment.id,
  };
}

const requestDeletion = (token, body) =>
  call('/account/delete', { method: 'POST', token, body: { password: 'password1234', ...body } });

describe('download my data', () => {
  test('a JSON file with profile, posts, likes, and history, and no secrets', async () => {
    const { token } = await memberWithContent('exporter');
    const res = await fetch(`${base}/account/export`, { headers: { Authorization: `Bearer ${token}` } });
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-disposition'), /attachment; filename="madebyjimbob-exporter-/);
    const text = await res.text();
    const data = JSON.parse(text);
    assert.equal(data.profile.username, 'exporter');
    assert.equal(data.profile.email, emailFor('exporter'));
    assert.equal(data.chatMessages[0].body, 'chat from exporter');
    assert.equal(data.comments[0].body, 'comment from exporter');
    assert.equal(data.likes[0].vote, 'like');
    assert.equal(data.watchProgress[0].position_ms, 42_000);
    assert.ok(data.securityHistory.some((e) => e.type === 'account_created'));
    assert.deepEqual(data.memberships, []);
    assert.deepEqual(data.superchats, []);
    assert.doesNotMatch(text, /password|"token"|scrypt/i);
    assert.equal((await call('/account/export')).status, 401);
  });
});

describe('deleting an account', () => {
  test('needs the password, signs out everywhere, emails the date, and waits 30 days', async () => {
    const token = await signIn(call, 'leaver');
    assert.equal((await requestDeletion(token, { password: 'wrong-password' })).status, 400);
    assert.equal((await userRow('leaver')).deletion_requested_at, null);

    const r = await requestDeletion(token);
    assert.equal(r.status, 200);
    assert.ok(new Date(r.data.eraseOn) > new Date(Date.now() + 29 * 86_400_000));
    assert.equal(await me(token), null, 'signed out');
    assert.equal(sent.at(-1).template, 'account_deletion_requested');
    assert.equal(sent.at(-1).to, emailFor('leaver'));

    await backdate('leaver', 29);
    assert.equal(await eraseDueAccounts(), 0, 'not before 30 days');
    assert.ok(await userRow('leaver'));
  });

  test('signing in within the 30 days calls it off', async () => {
    const token = await signIn(call, 'changed_mind');
    await requestDeletion(token);
    const back = await call('/auth/sign-in/username', {
      method: 'POST',
      body: { username: 'changed_mind', password: 'password1234' },
    });
    assert.equal(back.status, 200);
    assert.equal((await userRow('changed_mind')).deletion_requested_at, null);
    assert.equal((await me(back.token)).deletionCancelled, true);
    await backdate('changed_mind', 40); // even if it were old, there's no request any more
    await pool.query(`UPDATE users SET deletion_requested_at = NULL WHERE username = 'changed_mind'`);
    assert.equal(await eraseDueAccounts(), 0);
  });

  test('after 30 days the account is erased; messages stay as "Deleted user" and replies survive', async () => {
    const { token, chatId, commentId, replyId } = await memberWithContent('gone_keep');
    await requestDeletion(token);
    const { id } = await userRow('gone_keep');
    await backdate('gone_keep', 31);
    sent = [];
    assert.equal(await eraseDueAccounts(), 1);

    assert.equal(await userRow('gone_keep'), undefined);
    for (const table of ['sessions', 'accounts', 'watch_progress', 'video_votes', 'security_events']) {
      const { rowCount } = await pool.query(`SELECT 1 FROM ${table} WHERE user_id = $1`, [id]);
      assert.equal(rowCount, 0, table);
    }
    const chat = await pool.query(
      'SELECT author_name, user_id, body, hidden FROM chat_messages WHERE id = $1',
      [chatId],
    );
    assert.deepEqual(chat.rows[0], {
      author_name: 'Deleted user',
      user_id: null,
      body: 'chat from gone_keep',
      hidden: false,
    });
    const comment = await pool.query('SELECT author_name, body, hidden FROM comments WHERE id = $1', [
      commentId,
    ]);
    assert.deepEqual(comment.rows[0], {
      author_name: 'Deleted user',
      body: 'comment from gone_keep',
      hidden: false,
    });
    const reply = await pool.query('SELECT body FROM comments WHERE id = $1', [replyId]);
    assert.equal(reply.rows[0].body, 'nice point');

    assert.equal(sent.length, 1);
    assert.equal(sent[0].template, 'account_deleted');
    const { rowCount: logged } = await pool.query('SELECT 1 FROM emails WHERE to_email = $1', [
      emailFor('gone_keep'),
    ]);
    assert.equal(logged, 0, 'no record of emails to them is kept');
    assert.equal(await eraseDueAccounts(), 0, 'nothing left to erase');
  });

  test('with "remove my messages too", their chat and comments are blanked and hidden', async () => {
    const { token, chatId, commentId } = await memberWithContent('gone_remove');
    await requestDeletion(token, { deleteContent: true });
    assert.equal((await userRow('gone_remove')).delete_content, true);
    await backdate('gone_remove', 31);
    await eraseDueAccounts();
    const chat = await pool.query('SELECT author_name, body, hidden FROM chat_messages WHERE id = $1', [
      chatId,
    ]);
    assert.deepEqual(chat.rows[0], { author_name: 'Deleted user', body: '', hidden: true });
    const comment = await pool.query('SELECT body, hidden FROM comments WHERE id = $1', [commentId]);
    assert.deepEqual(comment.rows[0], { body: '', hidden: true });
    const visible = await call(`/videos/${videoId}/chat?from=0&to=60000`);
    assert.ok(!visible.data.messages.some((m) => m.id === chatId));
  });
});
