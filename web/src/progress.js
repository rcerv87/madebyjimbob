// Where the viewer stopped in each video. Kept in this browser for everyone, and on the account
// (PUT /api/videos/:id/progress) when signed in, so it follows them to other devices.
import { isSignedIn } from './api.js';
import { apiUrl, authHeaders } from './native.js';

const key = (videoId) => `mbjb_progress_${videoId}`;

export function readLocal(videoId) {
  try {
    const ms = Number(localStorage.getItem(key(videoId)));
    return Number.isFinite(ms) && ms > 0 ? ms : null;
  } catch {
    return null;
  }
}

// A video just marked watched or unwatched by hand keeps that mark while its page stays open: the player's own
// saves (every few seconds, and on leaving) would otherwise put the old position straight back.
const marked = new Set();
// Opening a video again makes its position count as usual.
export const watchingAgain = (videoId) => marked.delete(String(videoId));

export function saveProgress(videoId, positionMs, { mark = false } = {}) {
  if (mark) marked.add(String(videoId));
  else if (marked.has(String(videoId))) return;
  const ms = Math.max(0, Math.floor(positionMs));
  try {
    localStorage.setItem(key(videoId), String(ms));
  } catch {
    /* private mode: only the account copy is kept */
  }
  if (!isSignedIn()) return;
  // keepalive lets the save finish even when the tab is closing.
  fetch(apiUrl(`/videos/${videoId}/progress`), {
    method: 'PUT',
    keepalive: true,
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ positionMs: ms }),
  }).catch(() => {});
}

// Resume only if they got past the opening and didn't finish (the last 30s count as finished).
export function resumePoint(savedMs, durationS) {
  if (!savedMs || savedMs < 10_000) return null;
  if (durationS && savedMs > durationS * 1000 - 30_000) return null;
  return savedMs;
}

// Watched, in progress, or unwatched (MBJ-814), from where the viewer stopped: the last 30 seconds count as
// finished, the first 10 as not started. Marking a video watched puts its position at the end; unwatched, at 0.
export function watchState(positionMs, durationS) {
  const ms = positionMs || 0;
  if (durationS && ms >= durationS * 1000 - 30_000) return 'watched';
  return ms > 10_000 ? 'progress' : 'unwatched';
}
// From the account when signed in (the list carries progressMs), otherwise this browser.
export const positionOf = (v) => v.progressMs ?? readLocal(v.id) ?? 0;
export const stateOf = (v) => watchState(positionOf(v), v.durationS);
export const markWatched = (v) => saveProgress(v.id, (v.durationS || 0) * 1000, { mark: true });
export const markUnwatched = (v) => saveProgress(v.id, 0, { mark: true });

// Everything not finished, to play back to back: what's in progress first, then the rest oldest to newest
// (or newest first). `keepId` stays in even if it's finished (the video being watched right now).
export function bingeQueue(videos, { newestFirst = false, keepId } = {}) {
  const open = videos.filter((v) => stateOf(v) !== 'watched' || String(v.id) === String(keepId));
  const when = (v) => new Date(v.publishedAt || 0).getTime();
  const rest = open
    .filter((v) => stateOf(v) !== 'progress')
    .sort((a, b) => (newestFirst ? when(b) - when(a) : when(a) - when(b)));
  return [...open.filter((v) => stateOf(v) === 'progress'), ...rest];
}

// A random id for this browser, so a signed-out viewer counts once per video per day (MBJ-216). Not tied to
// anything else; clearing site data makes a new one.
export function viewerId() {
  try {
    let id = localStorage.getItem('mbjb_viewer');
    if (!id) {
      id = crypto.randomUUID();
      localStorage.setItem('mbjb_viewer', id);
    }
    return id;
  } catch {
    return undefined;
  }
}
