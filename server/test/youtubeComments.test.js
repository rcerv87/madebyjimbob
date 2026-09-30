import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseComment, parseComments } from '../src/ingest/youtubeComments.js';

// Shaped like yt-dlp's `comments` entries (values are strings or numbers depending on version).
const top = {
  id: 'UgxTOP',
  parent: 'root',
  text: '  Great debate  ',
  author: '@Viewer',
  author_id: 'UCviewer',
  author_thumbnail: 'https://yt3/v.jpg',
  author_is_uploader: 'False',
  like_count: '104',
  is_pinned: 'True',
  timestamp: '1790712000',
};
const creatorReply = {
  id: 'UgxTOP.REPLY1',
  parent: 'UgxTOP',
  text: 'Thanks!',
  author: '@MadebyJimbob',
  author_is_uploader: true,
  like_count: 3,
  timestamp: 1790715600,
};
// A reply to a reply: yt-dlp points `parent` at the earlier reply, not the thread.
const replyToReply = { id: 'UgxTOP.REPLY2', parent: 'UgxTOP.REPLY1', text: 'agreed', author: '@Other' };

test('parses a top-level comment', () => {
  const c = parseComment(top);
  assert.equal(c.parentExternalId, null);
  assert.equal(c.body, 'Great debate');
  assert.equal(c.likeCount, 104);
  assert.equal(c.pinned, true);
  assert.equal(c.isCreator, false);
  assert.equal(c.postedAt.toISOString(), new Date(1790712000 * 1000).toISOString());
});

test('flags the channel owner and links replies to their thread', () => {
  const c = parseComment(creatorReply);
  assert.equal(c.isCreator, true);
  assert.equal(c.parentExternalId, 'UgxTOP');
});

test('replies to replies attach to the top-level comment, not the reply', () => {
  assert.equal(parseComment(replyToReply).parentExternalId, 'UgxTOP');
});

test('parseComments splits threads and replies and drops orphans and empties', () => {
  const orphan = { id: 'UgxGONE.R', parent: 'UgxGONE', text: 'parent deleted' };
  const empty = { id: 'UgxEMPTY', parent: 'root', text: '   ' };
  const { topLevel, replies } = parseComments([top, creatorReply, replyToReply, orphan, empty, null]);
  assert.deepEqual(
    topLevel.map((c) => c.externalId),
    ['UgxTOP'],
  );
  assert.deepEqual(
    replies.map((c) => c.externalId),
    ['UgxTOP.REPLY1', 'UgxTOP.REPLY2'],
  );
});

test('replies remember the exact comment they answer', () => {
  assert.equal(parseComment(creatorReply).replyToExternalId, 'UgxTOP');
  assert.equal(parseComment(replyToReply).replyToExternalId, 'UgxTOP.REPLY1');
  assert.equal(parseComment(top).replyToExternalId, null);
});

test('picks up the first timestamp typed in a comment, within the video length', () => {
  const at = (text, durationMs) => parseComment({ id: 'x', parent: 'root', text }, { durationMs }).offsetMs;
  assert.equal(at('lmao 1:04:32 and again at 1:10:00'), (3600 + 4 * 60 + 32) * 1000);
  assert.equal(at('at 12:05 he says it'), (12 * 60 + 5) * 1000);
  assert.equal(at('see 2:30:00', 60 * 60 * 1000), null, 'past the end of a 1-hour video');
  assert.equal(at('no time here, ratio 3:1 or 10:30:45:12'), null);
});
