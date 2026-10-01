// Importing videos from Studio (MBJ-701). Studio queues YouTube links; the import helper on Ruben's PC
// (`npm run import:worker`) claims one at a time, runs scripts/import-youtube.js (yt-dlp works from a home
// connection; YouTube blocks data centres), and reports each step back here.
import { pool } from './db.js';

export const WORKER_ONLINE_MS = 60_000;

// The video id from a YouTube watch, youtu.be, live, or shorts link (or a bare 11-character id).
export function youtubeId(input) {
  const s = String(input || '').trim();
  if (/^[A-Za-z0-9_-]{11}$/.test(s)) return s;
  let u;
  try {
    u = new URL(s.startsWith('http') ? s : `https://${s}`);
  } catch {
    return null;
  }
  const host = u.hostname.replace(/^(www\.|m\.|music\.)/, '');
  let id = null;
  if (host === 'youtu.be') id = u.pathname.slice(1);
  else if (host === 'youtube.com') {
    id = u.searchParams.get('v') || u.pathname.match(/^\/(?:live|shorts|embed)\/([^/?#]+)/)?.[1] || null;
  }
  return id && /^[A-Za-z0-9_-]{11}$/.test(id) ? id : null;
}

export function jobRow(r) {
  return {
    id: r.id,
    url: r.url,
    youtubeId: r.youtube_id,
    tier: r.tier,
    withComments: r.with_comments,
    status: r.status,
    step: r.step,
    title: r.title,
    error: r.error,
    videoId: r.video_id,
    createdAt: r.created_at,
    startedAt: r.started_at,
    finishedAt: r.finished_at,
  };
}

// Queues each link once: skips bad links, ones already queued or running, and videos already on the site.
export async function queueImports(lines, { tier = 'free', withComments = true, requestedBy = null } = {}) {
  const queued = [];
  const skipped = [];
  const seen = new Set();
  for (const raw of lines.map((l) => String(l).trim()).filter(Boolean)) {
    const id = youtubeId(raw);
    if (!id) {
      skipped.push({ url: raw, reason: 'Not a YouTube video link' });
      continue;
    }
    if (seen.has(id)) continue;
    seen.add(id);
    const { rows: onSite } = await pool.query('SELECT id FROM videos WHERE youtube_id = $1', [id]);
    if (onSite[0]) {
      skipped.push({ url: raw, reason: 'You already have this', videoId: onSite[0].id });
      continue;
    }
    const { rowCount: waiting } = await pool.query(
      `SELECT 1 FROM import_jobs WHERE youtube_id = $1 AND status IN ('queued', 'running')`,
      [id],
    );
    if (waiting) {
      skipped.push({ url: raw, reason: 'Already queued' });
      continue;
    }
    const { rows } = await pool.query(
      `INSERT INTO import_jobs (url, youtube_id, tier, with_comments, requested_by) VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [`https://www.youtube.com/watch?v=${id}`, id, tier, withComments, requestedBy],
    );
    queued.push(jobRow(rows[0]));
  }
  return { queued, skipped };
}

export async function helperStatus() {
  const { rows } = await pool.query(
    'SELECT name, last_seen FROM import_workers ORDER BY last_seen DESC LIMIT 1',
  );
  const w = rows[0];
  return w
    ? {
        name: w.name,
        lastSeen: w.last_seen,
        online: Date.now() - new Date(w.last_seen).getTime() < WORKER_ONLINE_MS,
      }
    : null;
}

export async function listImports() {
  const [jobs, workers] = await Promise.all([
    pool.query('SELECT * FROM import_jobs ORDER BY created_at DESC, id DESC LIMIT 100'),
    pool.query('SELECT name, last_seen FROM import_workers ORDER BY last_seen DESC LIMIT 1'),
  ]);
  const w = workers.rows[0];
  return {
    jobs: jobs.rows.map(jobRow),
    helper: w
      ? {
          name: w.name,
          lastSeen: w.last_seen,
          online: Date.now() - new Date(w.last_seen).getTime() < WORKER_ONLINE_MS,
        }
      : null,
  };
}

// ---------- used by the helper ----------

export async function heartbeat(name, jobId = null) {
  await pool.query(
    `INSERT INTO import_workers (name, last_seen, job_id) VALUES ($1, now(), $2)
     ON CONFLICT (name) DO UPDATE SET last_seen = now(), job_id = EXCLUDED.job_id`,
    [name, jobId],
  );
}

// The oldest queued job, now marked running (safe if two helpers ever run at once).
export async function claimNext() {
  const { rows } = await pool.query(
    `UPDATE import_jobs SET status = 'running', started_at = now(), step = 'Starting', error = NULL
     WHERE id = (SELECT id FROM import_jobs WHERE status = 'queued' ORDER BY id LIMIT 1 FOR UPDATE SKIP LOCKED)
     RETURNING *`,
  );
  return rows[0] ? jobRow(rows[0]) : null;
}

export async function reportStep(id, { step, title, videoId } = {}) {
  await pool.query(
    `UPDATE import_jobs SET step = COALESCE($2, step), title = COALESCE($3, title), video_id = COALESCE($4, video_id)
     WHERE id = $1`,
    [
      id,
      step ? String(step).slice(0, 300) : null,
      title ? String(title).slice(0, 300) : null,
      videoId ?? null,
    ],
  );
}

export async function finishJob(id, { ok, error = null, videoId = null }) {
  await pool.query(
    `UPDATE import_jobs SET status = $2, error = $3, video_id = COALESCE($4, video_id), finished_at = now(),
       step = CASE WHEN $2 = 'done' THEN 'Done' ELSE step END
     WHERE id = $1`,
    [id, ok ? 'done' : 'failed', error ? String(error).slice(0, 2000) : null, videoId],
  );
}

// A helper that stopped mid-import: put its job back in the queue.
export async function requeueRunning() {
  const { rowCount } = await pool.query(
    `UPDATE import_jobs SET status = 'queued', step = NULL, started_at = NULL WHERE status = 'running'`,
  );
  return rowCount;
}
