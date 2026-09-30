// Where the viewer stopped in each video. Kept in this browser for everyone, and on the account
// (PUT /api/videos/:id/progress) when signed in, so it follows them to other devices.
import { isSignedIn } from './api.js';

const key = (videoId) => `mbjb_progress_${videoId}`;

export function readLocal(videoId) {
  try {
    const ms = Number(localStorage.getItem(key(videoId)));
    return Number.isFinite(ms) && ms > 0 ? ms : null;
  } catch {
    return null;
  }
}

export function saveProgress(videoId, positionMs) {
  const ms = Math.max(0, Math.floor(positionMs));
  try {
    localStorage.setItem(key(videoId), String(ms));
  } catch {
    /* private mode: only the account copy is kept */
  }
  if (!isSignedIn()) return;
  // keepalive lets the save finish even when the tab is closing.
  fetch(`/api/videos/${videoId}/progress`, {
    method: 'PUT',
    keepalive: true,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ positionMs: ms }),
  }).catch(() => {});
}

// Resume only if they got past the opening and didn't finish (the last 30s count as finished).
export function resumePoint(savedMs, durationS) {
  if (!savedMs || savedMs < 10_000) return null;
  if (durationS && savedMs > durationS * 1000 - 30_000) return null;
  return savedMs;
}
