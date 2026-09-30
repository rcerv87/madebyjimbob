// Parser for YouTube chat replay files (yt-dlp's `<id>.live_chat.json`, one JSON object per line).
// Pure functions only, so live ingest (MBJ-302) can reuse them on API payloads.
import { extractMentions } from '../moderation.js';

// Message runs -> plain text. Custom emoji become :shortcut:, standard emoji their character.
export function runsToText(runs = []) {
  return runs
    .map((r) => {
      if (r.text !== undefined) return r.text;
      if (r.emoji) {
        return r.emoji.isCustomEmoji
          ? `:${(r.emoji.shortcuts?.[0] || 'emoji').replace(/:/g, '')}:`
          : r.emoji.emojiId || '';
      }
      return '';
    })
    .join('');
}

// One chat item renderer -> message fields, or null for items we don't store (stickers, banners, ...).
export function parseItem(item) {
  const r =
    item.liveChatTextMessageRenderer ||
    item.liveChatPaidMessageRenderer ||
    item.liveChatMembershipItemRenderer;
  if (!r || !r.id) return null;

  let kind = 'text';
  let body = runsToText(r.message?.runs);
  let amount = null;
  if (item.liveChatPaidMessageRenderer) {
    kind = 'paid';
    amount = r.purchaseAmountText?.simpleText || null;
  } else if (item.liveChatMembershipItemRenderer) {
    kind = 'membership';
    body = [runsToText(r.headerSubtext?.runs), body].filter(Boolean).join(' — ');
  }

  const photos = r.authorPhoto?.thumbnails || [];
  return {
    externalId: r.id,
    author: r.authorName?.simpleText || 'Unknown',
    channelId: r.authorExternalChannelId || null,
    photo: photos[photos.length - 1]?.url || null,
    kind,
    body,
    amount,
    mentions: extractMentions(body),
    sentAt: r.timestampUsec ? new Date(Number(r.timestampUsec) / 1000) : null,
  };
}

// One line of the replay file -> zero or more messages, each with offset_ms clamped to >= 0
// (chat sent before the stream started has a negative offset).
export function parseReplayLine(line) {
  if (!line.trim()) return [];
  let obj;
  try {
    obj = JSON.parse(line);
  } catch {
    return [];
  }
  const replay = obj.replayChatItemAction;
  if (!replay) return [];
  const offsetMs = Math.max(0, Number(replay.videoOffsetTimeMsec) || 0);
  const out = [];
  for (const action of replay.actions || []) {
    const item = action.addChatItemAction?.item;
    const m = item && parseItem(item);
    if (m) out.push({ ...m, offsetMs });
  }
  return out;
}
