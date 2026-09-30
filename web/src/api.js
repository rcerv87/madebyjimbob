const TOKEN_KEY = 'mbjb_token';

export const getToken = () => localStorage.getItem(TOKEN_KEY);
export const setToken = (t) => (t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY));

export async function api(path, { method = 'GET', body } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`/api${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
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

// One formatter for the whole app: building one is far slower than using it, and lists format a lot.
const COMPACT = new Intl.NumberFormat('en', { notation: 'compact' });
export const compact = (n) => COMPACT.format(n || 0);

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
