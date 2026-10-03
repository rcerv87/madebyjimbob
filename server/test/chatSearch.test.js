import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, stopServer, client, signIn, seedVideo, pool } from './helpers.js';

let call;
let videoId;
const ids = {};
before(async () => {
  const { base } = await startServer();
  call = client(base);
  videoId = await seedVideo();
  await signIn(call, 'cs_mod');
  await pool.query(`UPDATE users SET role = 'mod' WHERE username = 'cs_mod'`);
  const modId = (await pool.query(`SELECT id FROM users WHERE username = 'cs_mod'`)).rows[0].id;
  const add = async (key, fields) => {
    const f = { source: 'youtube', kind: 'text', postedLive: true, userId: null, replyTo: null, ...fields };
    const { rows } = await pool.query(
      `INSERT INTO chat_messages (video_id, source, kind, author_name, body, offset_ms, posted_live, user_id, reply_to_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
      [
        videoId,
        f.source,
        f.kind,
        f.author,
        f.body,
        f.at,
        f.postedLive,
        f.userId,
        f.replyTo ? ids[f.replyTo] : null,
      ],
    );
    ids[key] = rows[0].id;
  };
  // Ruben's example: user 1 starts it; 2 replies; 1 answers 2; 3 answers 2; 4 answers 1's first message.
  await add('u1', { author: '@User1', body: 'Is free will real?', at: 10_000 });
  await add('u2', { author: '@User2', body: 'Depends what you mean', at: 12_000, replyTo: 'u1' });
  await add('u1b', { author: '@User1', body: 'The libertarian kind', at: 15_000, replyTo: 'u2' });
  await add('u3', { author: '@User3', body: 'Compatibilism FTW', at: 16_000, replyTo: 'u2' });
  await add('u4', { author: '@User4', body: 'No, 100% determined', at: 20_000, replyTo: 'u1' });
  await add('other', { author: '@Elsewhere', body: 'unrelated FREE pizza', at: 18_000 });
  await add('paid', { author: '@BigTipper', body: 'great stream', at: 30_000, kind: 'paid' });
  await add('site', { author: 'cs_mod', body: 'keep it civil', at: 40_000, source: 'native', userId: modId });
  await add('later', { author: '@Late', body: 'free will is fake', at: 50_000, postedLive: false });
});
after(stopServer);

const search = async (query) =>
  (await call(`/videos/${videoId}/chat/search?${new URLSearchParams(query)}`)).data;
const bodies = (r) => r.messages.map((m) => m.body);

describe('chat search (MBJ-218)', () => {
  test('words match anywhere in a message, any case, across the whole video, in video order', async () => {
    assert.deepEqual(bodies(await search({ q: 'free' })), [
      'Is free will real?',
      'unrelated FREE pizza',
      'free will is fake',
    ]);
    assert.deepEqual(bodies(await search({ q: '100%' })), ['No, 100% determined'], '% is just a character');
    assert.deepEqual(bodies(await search({ q: 'free', live: '1' })), [
      'Is free will real?',
      'unrelated FREE pizza',
    ]);
  });

  test('who said it: names or @handles, several at once', async () => {
    assert.deepEqual(bodies(await search({ from: 'user1' })), ['Is free will real?', 'The libertarian kind']);
    assert.deepEqual(bodies(await search({ from: '@User3,cs_mod' })), ['Compatibilism FTW', 'keep it civil']);
    assert.deepEqual(bodies(await search({ from: 'user1', q: 'kind' })), ['The libertarian kind']);
  });

  test('kinds: super chats, YouTube, site, JimBob and mods', async () => {
    assert.deepEqual(bodies(await search({ only: 'paid' })), ['great stream']);
    assert.deepEqual(bodies(await search({ only: 'site' })), ['keep it civil']);
    assert.deepEqual(bodies(await search({ only: 'staff' })), ['keep it civil']);
    assert.equal((await search({ only: 'youtube' })).messages.length, 8);
    assert.equal((await call(`/videos/${videoId}/chat/search?only=nope`)).status, 400);
    assert.equal((await call(`/videos/${videoId}/chat/search`)).status, 400, 'something to search for');
  });
});

describe('conversations (MBJ-222)', () => {
  test('from any message: everything that grew out of the first one, every branch, in video order', async () => {
    const expected = [
      'Is free will real?',
      'Depends what you mean',
      'The libertarian kind',
      'Compatibilism FTW',
      'No, 100% determined',
    ];
    for (const from of ['u1', 'u3', 'u4']) {
      const r = (await call(`/videos/${videoId}/chat/conversation/${ids[from]}`)).data;
      assert.deepEqual(bodies(r), expected, `from ${from}`);
    }
    // A message nobody answered is a conversation of one.
    assert.deepEqual(bodies((await call(`/videos/${videoId}/chat/conversation/${ids.other}`)).data), [
      'unrelated FREE pizza',
    ]);
    assert.equal((await call(`/videos/${videoId}/chat/conversation/999999999`)).status, 404);
  });
});
