// yt-dlp --flat-playlist -J output -> playlists and their ordered YouTube video ids. Pure functions.

const isPlaylistId = (id) => /^(PL|UU|FL|OLAK|RD)[\w-]+$/.test(String(id || ''));

// One playlist: { youtubeId, title, description, videoIds[] } (in playlist order, duplicates dropped).
export function parsePlaylist(json) {
  const seen = new Set();
  const videoIds = [];
  for (const e of json?.entries || []) {
    const id = e?.id && !isPlaylistId(e.id) ? String(e.id) : null;
    if (id && !seen.has(id)) {
      seen.add(id);
      videoIds.push(id);
    }
  }
  return {
    youtubeId: String(json?.id || ''),
    title: String(json?.title || 'Untitled playlist').trim(),
    description: String(json?.description || '').trim(),
    videoIds,
  };
}

// A channel's Playlists tab: the playlist ids it lists (in the channel's order).
export function channelPlaylistIds(json) {
  const ids = [];
  for (const e of json?.entries || []) {
    const fromUrl = String(e?.url || '').match(/[?&]list=([\w-]+)/)?.[1];
    const id = isPlaylistId(e?.id) ? String(e.id) : fromUrl;
    if (id && !ids.includes(id)) ids.push(id);
  }
  return ids;
}
