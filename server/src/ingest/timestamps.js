// Timestamps people type into comments ("1:04:32", "12:05"). Pure functions.

// Matches h:mm:ss or m:ss, not inside a longer number or ratio (e.g. "10:30:45:12", "3:1").
const STAMP = /(?<![\d:])(?:(\d{1,2}):)?([0-5]?\d):([0-5]\d)(?![\d:])/g;

// Every timestamp in the text as milliseconds, in order; ones past maxMs (the video length) dropped.
export function findTimestamps(text, maxMs = Infinity) {
  const out = [];
  for (const m of String(text).matchAll(STAMP)) {
    const [, h, min, s] = m;
    const ms = ((Number(h || 0) * 60 + Number(min)) * 60 + Number(s)) * 1000;
    if (ms <= maxMs) out.push(ms);
  }
  return out;
}

export const firstTimestampMs = (text, maxMs) => findTimestamps(text, maxMs)[0] ?? null;
