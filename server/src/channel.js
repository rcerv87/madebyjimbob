// Pick videos from the channel to import (MBJ-706). Studio asks for a channel's video list; with a YouTube Data
// API key (YOUTUBE_API_KEY) the server fetches it, otherwise the import helper on Ruben's PC lists it with yt-dlp.
// Either way the list lands in channel_videos, and Studio shows each video as on the site, queued, or new.
import { pool } from './db.js';
import { logger } from './logger.js';

export const JIMBOB_CHANNEL = 'https://www.youtube.com/@madebyjimbob';
const API = 'https://www.googleapis.com/youtube/v3';

export const apiKeyConfigured = () => Boolean(process.env.YOUTUBE_API_KEY);

// '@handle', a youtube.com/@handle (or /videos, /streams, /shorts) link, or a /channel/UC… link →
// { key, url, handle?, id? }. key is the lower-cased @handle or the UC… id.
export function parseChannel(input) {
  let s = String(input || '').trim();
  if (!s) return null;
  if (/^@[\w.-]{3,30}$/.test(s)) s = `https://www.youtube.com/${s}`;
  if (/^UC[\w-]{22}$/.test(s)) s = `https://www.youtube.com/channel/${s}`;
  let u;
  try {
    u = new URL(s.startsWith('http') ? s : `https://${s}`);
  } catch {
    return null;
  }
  if (!/^(www\.|m\.)?youtube\.com$/.test(u.hostname)) return null;
  const handle = u.pathname.match(/^\/(@[\w.-]{3,30})(?:\/|$)/)?.[1];
  if (handle) return { key: handle.toLowerCase(), url: `https://www.youtube.com/${handle}`, handle };
  const id = u.pathname.match(/^\/channel\/(UC[\w-]{22})(?:\/|$)/)?.[1];
  if (id) return { key: id, url: `https://www.youtube.com/channel/${id}`, id };
  return null;
}

export function listingRow(r) {
  if (!r) return null;
  return {
    id: r.id,
    channelUrl: r.channel_url,
    status: r.status,
    source: r.source,
    videoCount: r.video_count,
    error: r.error,
    createdAt: r.created_at,
    finishedAt: r.finished_at,
  };
}

async function latestListing(key) {
  const { rows } = await pool.query(
    'SELECT * FROM channel_listings WHERE channel_key = $1 ORDER BY created_at DESC, id DESC LIMIT 1',
    [key],
  );
  return rows[0] || null;
}

// Ask for a fresh list. With an API key it's fetched right away (in the background); otherwise it waits for the
// helper. A request already waiting for the same channel is reused.
export async function requestListing(channel, requestedBy = null) {
  const latest = await latestListing(channel.key);
  if (latest && (latest.status === 'queued' || latest.status === 'running')) return listingRow(latest);
  const source = apiKeyConfigured() ? 'api' : 'helper';
  const { rows } = await pool.query(
    `INSERT INTO channel_listings (channel_key, channel_url, status, source, requested_by, started_at)
     VALUES ($1, $2, $3, $4, $5, CASE WHEN $4 = 'api' THEN now() END) RETURNING *`,
    [channel.key, channel.url, source === 'api' ? 'running' : 'queued', source, requestedBy],
  );
  const listing = rows[0];
  if (source === 'api') {
    listViaApi(channel)
      .then((entries) => saveListing(listing.id, entries))
      .catch((err) => failListing(listing.id, err.message));
  }
  return listingRow(listing);
}

// Replaces the channel's list with these entries and marks the listing done.
export async function saveListing(listingId, entries) {
  const { rows } = await pool.query('SELECT channel_key, started_at FROM channel_listings WHERE id = $1', [
    listingId,
  ]);
  if (!rows[0]) return;
  const key = rows[0].channel_key;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM channel_videos WHERE channel_key = $1', [key]);
    for (let i = 0; i < entries.length; i += 500) {
      const chunk = entries.slice(i, i + 500);
      await client.query(
        `INSERT INTO channel_videos (channel_key, youtube_id, title, kind, published_at, duration_s, availability, position)
         SELECT $1, * FROM unnest($2::text[], $3::text[], $4::text[], $5::timestamptz[], $6::int[], $7::text[], $8::int[])
         ON CONFLICT (channel_key, youtube_id) DO NOTHING`,
        [
          key,
          chunk.map((e) => e.youtubeId),
          chunk.map((e) => e.title || ''),
          chunk.map((e) => e.kind),
          chunk.map((e) => e.publishedAt || null),
          chunk.map((e) => (Number.isFinite(e.durationS) ? Math.round(e.durationS) : null)),
          chunk.map((e) => e.availability || null),
          chunk.map((e, j) => (Number.isFinite(e.position) ? e.position : i + j)),
        ],
      );
    }
    await client.query(
      `UPDATE channel_listings SET status = 'done', video_count = $2, error = NULL, finished_at = now() WHERE id = $1`,
      [listingId, entries.length],
    );
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

export async function failListing(listingId, error) {
  logger.warn({ listingId, error }, 'channel listing failed');
  await pool.query(
    `UPDATE channel_listings SET status = 'failed', error = $2, finished_at = now() WHERE id = $1`,
    [listingId, String(error).slice(0, 1000)],
  );
}

// ---------- YouTube Data API (when YOUTUBE_API_KEY is set) ----------

const isoSeconds = (iso) => {
  const m = /^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(String(iso || ''));
  if (!m) return null;
  return (+m[1] || 0) * 86400 + (+m[2] || 0) * 3600 + (+m[3] || 0) * 60 + (+m[4] || 0);
};

async function api(path, params) {
  const url = new URL(`${API}/${path}`);
  for (const [k, v] of Object.entries({ ...params, key: process.env.YOUTUBE_API_KEY }))
    url.searchParams.set(k, v);
  const res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`YouTube API: ${body.error?.message || res.status}`);
  return body;
}

// Every upload on the channel (the uploads playlist), with lengths and live/short kinds from videos.list.
// About 2 quota units per 50 videos (the free quota is 10,000 a day).
export async function listViaApi(channel) {
  const ch = await api('channels', {
    part: 'contentDetails',
    ...(channel.id ? { id: channel.id } : { forHandle: channel.handle }),
  });
  const uploads = ch.items?.[0]?.contentDetails?.relatedPlaylists?.uploads;
  if (!uploads) throw new Error('YouTube didn’t find that channel.');
  const entries = [];
  let pageToken;
  do {
    const page = await api('playlistItems', {
      part: 'snippet,contentDetails',
      playlistId: uploads,
      maxResults: 50,
      ...(pageToken ? { pageToken } : {}),
    });
    const ids = page.items.map((it) => it.contentDetails.videoId);
    const details = ids.length
      ? await api('videos', { part: 'contentDetails,liveStreamingDetails,status', id: ids.join(',') })
      : { items: [] };
    const byId = new Map(details.items.map((v) => [v.id, v]));
    for (const it of page.items) {
      const v = byId.get(it.contentDetails.videoId);
      if (!v) continue; // private or removed
      const durationS = isoSeconds(v.contentDetails?.duration);
      const live = Boolean(v.liveStreamingDetails);
      if (live && !v.liveStreamingDetails.actualEndTime) continue; // upcoming or live right now
      entries.push({
        youtubeId: v.id,
        title: it.snippet.title,
        // The API has no "short" flag; vertical videos up to 3 minutes are what YouTube treats as Shorts.
        kind: live ? 'live' : durationS !== null && durationS <= 180 ? 'short' : 'video',
        publishedAt: it.contentDetails.videoPublishedAt || it.snippet.publishedAt,
        durationS,
        availability: v.status?.privacyStatus || null,
        position: entries.length,
      });
    }
    pageToken = page.nextPageToken;
  } while (pageToken);
  return entries;
}

// ---------- the import helper (no API key) ----------

const TAB_KIND = { videos: 'video', streams: 'live', shorts: 'short' };
export const CHANNEL_TABS = Object.keys(TAB_KIND);

// yt-dlp --flat-playlist -J output for one channel tab → entries. Skips upcoming and live-now streams.
export function parseTab(json, tab) {
  return (json?.entries || [])
    .filter((e) => e?.id && !['is_upcoming', 'is_live'].includes(e.live_status))
    .map((e, i) => ({
      youtubeId: e.id,
      title: e.title || '',
      kind: TAB_KIND[tab],
      publishedAt: e.timestamp ? new Date(e.timestamp * 1000).toISOString() : null,
      durationS: Number.isFinite(e.duration) ? e.duration : null,
      availability: e.availability || null,
      position: i,
    }));
}

export async function claimNextListing() {
  const { rows } = await pool.query(
    `UPDATE channel_listings SET status = 'running', started_at = now()
     WHERE id = (SELECT id FROM channel_listings WHERE status = 'queued' AND source = 'helper'
                 ORDER BY id LIMIT 1 FOR UPDATE SKIP LOCKED)
     RETURNING *`,
  );
  return rows[0] || null;
}

// ---------- what Studio shows ----------

const STATE_SQL = `CASE WHEN v.id IS NOT NULL THEN 'onsite' WHEN j.id IS NOT NULL THEN 'queued' ELSE 'new' END`;
const FROM_SQL = `FROM channel_videos cv
  LEFT JOIN videos v ON v.youtube_id = cv.youtube_id
  LEFT JOIN LATERAL (SELECT id FROM import_jobs ij WHERE ij.youtube_id = cv.youtube_id
                       AND ij.status IN ('queued', 'running') LIMIT 1) j ON true`;

export async function channelPage(
  channel,
  { show = 'new', kind = 'all', q = '', offset = 0, limit = 100 } = {},
) {
  const where = ['cv.channel_key = $1'];
  const params = [channel.key];
  if (show === 'new') where.push('v.id IS NULL AND j.id IS NULL');
  if (['video', 'live', 'short'].includes(kind)) {
    params.push(kind);
    where.push(`cv.kind = $${params.length}`);
  }
  if (q) {
    params.push(`%${String(q).replace(/[\\%_]/g, (c) => `\\${c}`)}%`);
    where.push(`cv.title ILIKE $${params.length}`);
  }
  const lim = Math.min(Math.max(Math.floor(Number(limit)) || 100, 1), 500);
  const off = Math.max(Math.floor(Number(offset)) || 0, 0);
  const pageParams = [...params, lim, off];
  const [page, total, counts, listing] = await Promise.all([
    pool.query(
      `SELECT cv.*, v.id AS video_id, ${STATE_SQL} AS state ${FROM_SQL}
       WHERE ${where.join(' AND ')}
       ORDER BY cv.published_at DESC NULLS LAST, cv.kind, cv.position
       LIMIT $${pageParams.length - 1} OFFSET $${pageParams.length}`,
      pageParams,
    ),
    pool.query(`SELECT count(*)::int AS n ${FROM_SQL} WHERE ${where.join(' AND ')}`, params),
    pool.query(
      `SELECT count(*)::int AS all,
              count(*) FILTER (WHERE v.id IS NOT NULL)::int AS onsite,
              count(*) FILTER (WHERE v.id IS NULL AND j.id IS NOT NULL)::int AS queued,
              count(*) FILTER (WHERE v.id IS NULL AND j.id IS NULL)::int AS new
       ${FROM_SQL} WHERE cv.channel_key = $1`,
      [channel.key],
    ),
    latestListing(channel.key),
  ]);
  return {
    channel: { key: channel.key, url: channel.url },
    listing: listingRow(listing),
    apiKey: apiKeyConfigured(),
    counts: counts.rows[0],
    total: total.rows[0].n,
    offset: off,
    videos: page.rows.map((r) => ({
      youtubeId: r.youtube_id,
      title: r.title,
      kind: r.kind,
      publishedAt: r.published_at,
      durationS: r.duration_s,
      availability: r.availability,
      thumbnail: `https://i.ytimg.com/vi/${r.youtube_id}/mqdefault.jpg`,
      state: r.state,
      videoId: r.video_id,
    })),
  };
}
