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

export function extractMentions(text) {
  const out = new Set();
  for (const m of String(text).matchAll(/@([A-Za-z0-9_]{3,32})/g)) out.add(m[1].toLowerCase());
  return [...out];
}
