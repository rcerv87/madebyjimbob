// Live playlists for viewers (MBJ-311). Every viewer re-reads a quality's playlist about once a second; Owncast uploads
// its playlists with no-cache, so each of those reads cost an R2 read. The recorder re-publishes them under
// <prefix>/live/<n>.m3u8 with a 1-second cache, so Cloudflare answers nearly all of them, however many watch.
// It also leaves out pieces that haven't finished uploading: Owncast lists a piece before its upload is done, and a
// player asking for it too early got a 404 that Cloudflare would then cache.

const HEADER =
  /^#EXT(M3U$|-X-(VERSION|TARGETDURATION|MEDIA-SEQUENCE|DISCONTINUITY-SEQUENCE|PLAYLIST-TYPE|INDEPENDENT-SEGMENTS|ALLOW-CACHE)\b)/;

// A media playlist → { head: [tags], entries: [{ tags, uri }], ended }.
export function parsePlaylist(text) {
  const head = [];
  const entries = [];
  let tags = [];
  let ended = false;
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    if (line === '#EXT-X-ENDLIST') ended = true;
    else if (line.startsWith('#')) {
      if (!entries.length && !tags.length && HEADER.test(line)) head.push(line);
      else tags.push(line);
    } else {
      entries.push({ tags, uri: line });
      tags = [];
    }
  }
  return { head, entries, ended };
}

// Where a piece listed in quality n's playlist lives in the bucket.
export const pieceKey = (n, uri) =>
  /^https?:\/\//.test(uri) ? new URL(uri).pathname.slice(1) : `hls/${n}/${uri}`;

// Owncast's playlist for quality n → the viewers' copy, or null if nothing is uploaded yet. `isUploaded(key)` says
// whether a piece is in the bucket; only the newest few can still be uploading. `up` leads from the copy's folder to
// the bucket root (e.g. '../../' for dvr/live/).
export async function edgePlaylist(text, n, { isUploaded, up, check = 3 }) {
  const { head, entries, ended } = parsePlaylist(text);
  let keep = entries.length;
  for (let i = entries.length - 1; i >= Math.max(0, entries.length - check); i -= 1) {
    if (await isUploaded(pieceKey(n, entries[i].uri))) break;
    keep = i;
  }
  if (!keep) return null;
  const lines = [...head];
  for (const e of entries.slice(0, keep))
    lines.push(...e.tags, /^https?:\/\//.test(e.uri) ? e.uri : `${up}hls/${n}/${e.uri}`);
  if (ended && keep === entries.length) lines.push('#EXT-X-ENDLIST');
  return `${lines.join('\n')}\n`;
}
