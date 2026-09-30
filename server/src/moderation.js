const banned = (process.env.BANNED_WORDS || '')
  .split(',')
  .map((w) => w.trim().toLowerCase())
  .filter(Boolean);

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const bannedRe = banned.length ? new RegExp(`\\b(${banned.map(escape).join('|')})\\b`, 'gi') : null;

export function filterText(text) {
  const clean = String(text).replace(/\s+/g, ' ').trim();
  return bannedRe ? clean.replace(bannedRe, (m) => '*'.repeat(m.length)) : clean;
}

// @name: 3–32 chars of letters, digits, _ and (inside, not at the ends) . and -, so YouTube
// handles like @Bro-tl7qq match whole and "hi @jimbob." drops the period. Not preceded by a
// word character, so emails don't count. Keep in sync with MENTION_SPLIT in web ChatPanel.
export const MENTION_RE = /(?<![A-Za-z0-9_])@([A-Za-z0-9_](?:[A-Za-z0-9_.-]{1,30}[A-Za-z0-9_])?)/g;

export function extractMentions(text) {
  const out = new Set();
  for (const m of String(text).matchAll(MENTION_RE)) {
    if (m[1].length >= 3) out.add(m[1].toLowerCase());
  }
  return [...out];
}
