#!/usr/bin/env node
// Imports YouTube playlists (title, description, and video order) into the playlists tables.
// Videos that aren't imported yet are remembered by YouTube id and show up once they are.
//
// Usage:
//   npm run import:playlists -- <playlist URL>          one playlist
//   npm run import:playlists -- <channel URL>           every playlist on the channel's Playlists tab
//
// Re-running is safe: each playlist's order is replaced with YouTube's current order.
import { execFileSync } from 'child_process';
import { pool, migrate } from '../src/db.js';
import { parsePlaylist, channelPlaylistIds } from '../src/ingest/youtubePlaylist.js';

const url = process.argv.slice(2).find((a) => !a.startsWith('--'));
if (!url) {
  console.error('Usage: npm run import:playlists -- <playlist URL or channel URL>');
  process.exit(1);
}

const flat = (u) =>
  JSON.parse(
    execFileSync('yt-dlp', ['--flat-playlist', '-J', '--no-warnings', u], {
      encoding: 'utf8',
      maxBuffer: 1024 * 1024 * 64,
    }),
  );

const single = url.match(/[?&]list=([\w-]+)/)?.[1];
let playlistIds;
if (single) {
  playlistIds = [single];
} else {
  const channel = url.replace(/\/+$/, '').replace(/\/(videos|streams|shorts|playlists|featured)$/, '');
  console.log('Reading the channel’s playlists…');
  playlistIds = channelPlaylistIds(flat(`${channel}/playlists`));
  console.log(`  ${playlistIds.length} playlist(s)`);
}

await migrate();
for (const id of playlistIds) {
  const p = parsePlaylist(flat(`https://www.youtube.com/playlist?list=${id}`));
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `INSERT INTO playlists (source, youtube_id, title, description) VALUES ('youtube', $1, $2, $3)
       ON CONFLICT (youtube_id) DO UPDATE SET title = EXCLUDED.title, description = EXCLUDED.description,
         updated_at = now()
       RETURNING id`,
      [p.youtubeId || id, p.title, p.description],
    );
    const playlistId = rows[0].id;
    await client.query('DELETE FROM playlist_items WHERE playlist_id = $1', [playlistId]);
    if (p.videoIds.length) {
      await client.query(
        `INSERT INTO playlist_items (playlist_id, position, youtube_id, video_id)
         SELECT $1, ord - 1, yt, (SELECT v.id FROM videos v WHERE v.youtube_id = yt)
         FROM unnest($2::text[]) WITH ORDINALITY AS x(yt, ord)`,
        [playlistId, p.videoIds],
      );
    }
    await client.query('COMMIT');
    const { rows: have } = await pool.query(
      'SELECT count(*) FROM videos WHERE youtube_id = ANY($1::text[])',
      [p.videoIds],
    );
    const imported = Number(have[0].count);
    console.log(
      `${p.title}: ${p.videoIds.length} video(s), ${imported} on the site` +
        (imported < p.videoIds.length ? `, ${p.videoIds.length - imported} not imported yet` : ''),
    );
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(`${id}: ${err.message}`);
    process.exitCode = 1;
  } finally {
    client.release();
  }
}
await pool.end();
console.log('Done.');
