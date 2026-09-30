// Parser for YouTube comments as yt-dlp writes them (`--write-comments`, the `comments` array in
// `<id>.info.json`). Pure functions only. YouTube has one level of replies: `parent` is 'root' for
// top-level comments, otherwise the id of the top-level comment being answered.

import { firstTimestampMs } from './timestamps.js';

const toBool = (v) => v === true || v === 'True' || v === 'true';

// durationMs: the video's length, so typed timestamps past the end are ignored.
export function parseComment(c, { durationMs = Infinity } = {}) {
  if (!c || !c.id || typeof c.text !== 'string') return null;
  // A reply to a reply has `parent` set to that reply, but reply ids are "<threadId>.<replyId>",
  // so the thread's top-level comment is always the part before the dot.
  const id = String(c.id);
  const isReply = c.parent && c.parent !== 'root';
  const parent = isReply ? (id.includes('.') ? id.split('.')[0] : String(c.parent)) : null;
  const body = c.text.trim();
  return {
    externalId: String(c.id),
    parentExternalId: parent,
    // The exact comment answered: the thread's first comment, or an earlier reply in it.
    replyToExternalId: isReply ? String(c.parent) : null,
    author: c.author || 'Unknown',
    channelId: c.author_id || null,
    photo: c.author_thumbnail || null,
    isCreator: toBool(c.author_is_uploader),
    body,
    offsetMs: firstTimestampMs(body, durationMs),
    likeCount: Math.max(0, Math.floor(Number(c.like_count) || 0)),
    pinned: toBool(c.is_pinned),
    postedAt: c.timestamp ? new Date(Number(c.timestamp) * 1000) : null,
  };
}

// Splits into top-level comments and replies, dropping empty comments and replies whose parent
// isn't in the list (so every reply can be linked when inserted after its parent).
export function parseComments(list = [], options = {}) {
  const parsed = list.map((c) => parseComment(c, options)).filter((c) => c && c.body);
  const topLevel = parsed.filter((c) => !c.parentExternalId);
  const topIds = new Set(topLevel.map((c) => c.externalId));
  const replies = parsed.filter((c) => c.parentExternalId && topIds.has(c.parentExternalId));
  return { topLevel, replies };
}
