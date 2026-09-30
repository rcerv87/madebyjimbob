const banned = (process.env.BANNED_WORDS || '')
  .split(',')
  .map((w) => w.trim().toLowerCase())
  .filter(Boolean);

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const bannedRe = banned.length ? new RegExp(`\\b(${banned.map(escape).join('|')})\\b`, 'gi') : null;

const mask = (text) => (bannedRe ? text.replace(bannedRe, (m) => '*'.repeat(m.length)) : text);

// Usernames: any banned word anywhere in the name (names have no spaces, so word boundaries don't help).
export function containsBannedWord(text) {
  const t = String(text).toLowerCase();
  return banned.some((w) => t.includes(w));
}

// Chat: one line.
export function filterText(text) {
  return mask(String(text).replace(/\s+/g, ' ').trim());
}

// Comments: keep line breaks, but at most one blank line in a row.
export function filterComment(text) {
  const clean = String(text)
    .replace(/\r\n?/g, '\n')
    .replace(/[^\S\n]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return mask(clean);
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
