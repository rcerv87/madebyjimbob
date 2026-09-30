// Signed-in state lives in an httpOnly session cookie (MBJ-101) that the browser sends with every request.
let signedIn = false;
export const setSignedIn = (value) => {
  signedIn = Boolean(value);
};
export const isSignedIn = () => signedIn;

// Sign-in and sign-up errors (Better Auth codes) in plain words: what happened and how to fix it.
const AUTH_MESSAGES = {
  INVALID_USERNAME_OR_PASSWORD: 'That username and password don’t match. Check them, or reset your password.',
  INVALID_EMAIL_OR_PASSWORD: 'That email and password don’t match. Check them, or reset your password.',
  USERNAME_IS_ALREADY_TAKEN: 'That username is taken. Try another, for example with a number on the end.',
  USER_ALREADY_EXISTS: 'There’s already an account with that email. Sign in instead, or reset your password.',
  USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL:
    'There’s already an account with that email. Sign in instead, or reset your password.',
  INVALID_USERNAME: 'Usernames can use letters, numbers, and underscores (and no rude words).',
  USERNAME_TOO_SHORT: 'Usernames need at least 3 characters.',
  USERNAME_TOO_LONG: 'Usernames can be up to 32 characters.',
  PASSWORD_TOO_SHORT: 'Use a password of at least 10 characters.',
  PASSWORD_TOO_LONG: 'Use a password of at most 128 characters.',
  INVALID_EMAIL: 'Enter an email address like name@example.com.',
  INVALID_TOKEN: 'That link has expired or was already used. Ask for a new one.',
};

export async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(`/api${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 429) throw new Error('Too many tries. Wait a minute, then try again.');
    throw new Error(
      data.error || AUTH_MESSAGES[data.code] || data.message || `Request failed (${res.status})`,
    );
  }
  return data;
}

export function formatTime(totalSeconds = 0) {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
}

export function timeAgo(date) {
  if (!date) return '';
  const minutes = Math.floor((Date.now() - new Date(date)) / 60_000);
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} day${days === 1 ? '' : 's'} ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months} month${months === 1 ? '' : 's'} ago`;
  const years = Math.floor(months / 12);
  return `${years} year${years === 1 ? '' : 's'} ago`;
}

export const compact = (n) => Intl.NumberFormat('en', { notation: 'compact' }).format(n || 0);

// "1 view", "12 views", "1.2K views"
export const count = (n, noun, plural = `${noun}s`) => `${compact(n)} ${Number(n) === 1 ? noun : plural}`;

export const TIER_LABEL = { free: 'Free', plus: 'Plus', premium: 'Premium' };

// Splits text into plain parts and typed timestamps ("1:04:32", "12:05") so they can be made clickable.
// Same rule as server/src/ingest/timestamps.js.
const STAMP = /(?<![\d:])(?:(\d{1,2}):)?([0-5]?\d):([0-5]\d)(?![\d:])/g;
export function splitTimestamps(text) {
  const parts = [];
  let last = 0;
  for (const m of String(text).matchAll(STAMP)) {
    if (m.index > last) parts.push({ text: text.slice(last, m.index) });
    const ms = ((Number(m[1] || 0) * 60 + Number(m[2])) * 60 + Number(m[3])) * 1000;
    parts.push({ text: m[0], ms });
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push({ text: text.slice(last) });
  return parts;
}
