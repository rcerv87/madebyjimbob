import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { parseReplayLine, parseItem, runsToText } from '../src/ingest/youtubeReplay.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const lines = fs.readFileSync(path.join(__dirname, 'fixtures/live_chat.sample.jsonl'), 'utf8').split('\n');
const messages = lines.flatMap(parseReplayLine);
const byId = Object.fromEntries(messages.map((m) => [m.externalId, m]));

test('parses every supported message and skips everything else', () => {
  assert.deepEqual(
    messages.map((m) => m.externalId),
    ['pre-1', 'txt-1', 'paid-1', 'mem-1', 'txt-2'],
  );
});

test('clamps negative offsets (pre-stream chat) to 0', () => {
  assert.equal(byId['pre-1'].offsetMs, 0);
  assert.equal(byId['txt-1'].offsetMs, 65000);
});

test('text messages keep emoji, mentions, author, photo, and send time', () => {
  const m = byId['txt-1'];
  assert.equal(m.kind, 'text');
  assert.equal(m.body, 'great build 🔥 @JimBob :jimbob_wave:');
  assert.deepEqual(m.mentions, ['jimbob']);
  assert.equal(m.author, '@BigSue');
  assert.equal(m.channelId, 'UCsue');
  assert.equal(byId['pre-1'].photo, 'https://yt3/early-64.jpg', 'uses the largest thumbnail');
  assert.equal(m.sentAt.toISOString(), '2024-09-29T20:01:05.000Z');
});

test('super chats carry kind=paid and the display amount', () => {
  const m = byId['paid-1'];
  assert.equal(m.kind, 'paid');
  assert.equal(m.amount, '$20.00');
  assert.equal(m.body, 'for the guitar fund');
  assert.equal(m.offsetMs, 120500);
  assert.equal(m.sentAt, null);
});

test('memberships use the header text as the body', () => {
  const m = byId['mem-1'];
  assert.equal(m.kind, 'membership');
  assert.equal(m.body, 'Welcome to Workshop Crew!');
  assert.equal(m.photo, null);
});

test('edge cases', () => {
  assert.deepEqual(parseReplayLine('   '), []);
  assert.deepEqual(parseReplayLine('{broken'), []);
  assert.equal(parseItem({ liveChatTextMessageRenderer: { message: { runs: [] } } }), null, 'no id');
  assert.equal(runsToText(), '');
  assert.equal(runsToText([{ emoji: { isCustomEmoji: true } }]), ':emoji:');
  assert.equal(parseItem({ liveChatTextMessageRenderer: { id: 'x' } }).author, 'Unknown');
});
