// The Library Uploader's pure parts (tested in server/test/libraryUploader.test.js): matching files to YouTube
// videos, the ffmpeg command for each video, and the master playlist the site plays.

// Titles as files name them: lower case, letters and digits only. Takeout adds " (1)" to repeats.
// (Same as Studio → From files, web/src/components/StudioFileImport.jsx.)
export const normTitle = (s) =>
  String(s || '')
    .replace(/\.[a-z0-9]{2,4}$/i, '')
    .replace(/\s\(\d+\)$/, '')
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');

// A small CSV reader (quotes, commas and newlines inside quotes).
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"';
        i += 1;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') {
      row.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i += 1;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += ch;
  }
  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim()));
}

// Takeout's video metadata CSV → Map(normalized title → { youtubeId, title }).
export function takeoutIds(text) {
  const clean = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text; // a byte-order mark at the start, if any
  const rows = parseCsv(clean);
  const head = (rows[0] || []).map((h) => h.toLowerCase());
  const idCol = head.findIndex((h) => h.includes('video id'));
  const titleCol = head.findIndex((h) => h.includes('title'));
  const map = new Map();
  if (idCol < 0 || titleCol < 0) return map;
  for (const r of rows.slice(1)) {
    const id = (r[idCol] || '').trim();
    if (/^[\w-]{11}$/.test(id)) map.set(normTitle(r[titleCol]), { youtubeId: id, title: r[titleCol] });
  }
  return map;
}

export const VIDEO = /\.(mp4|mov|m4v|mkv|webm|avi|flv|ts)$/i;
export const isMetadataCsv = (name) => /\.csv$/i.test(name) && /video/i.test(name);

// Which YouTube video a file is: an [id] in the name, Takeout's CSV, or a unique title on the channel.
// → { youtubeId, title } or null (listed in needs-review.txt for Ruben).
export function matchFile(name, { csv, byTitle }) {
  const base = name.split(/[\\/]/).pop();
  const inName = base.match(/\[([\w-]{11})\]/)?.[1];
  if (inName) return { youtubeId: inName, title: base.replace(VIDEO, '') };
  const key = normTitle(base);
  if (csv.has(key)) return csv.get(key);
  const same = byTitle.get(key);
  return same?.length === 1 ? same[0] : null;
}

// The uploader's id for a source file: the zip part (or folder path), the entry, and its size.
export const fileKey = (container, entry, size) => `${container}|${entry}|${size}`;

const even = (n) => Math.max(2, Math.round(n / 2) * 2);

// The sizes the site plays: 720p and 360p (never upscaled), keeping the shape.
export function sizes(width, height) {
  const at = (h) => {
    const hh = Math.min(h, height);
    return { width: even((width * hh) / height), height: even(hh) };
  };
  return { hd: at(720), sd: at(360) };
}

// One ffmpeg run: 720p, 360p and the sound alone (Listen only), as HLS with 6-second pieces cut at the same moments.
// encoder: 'nvenc' (NVIDIA card) or 'x264' (processor). hasAudio: some videos have none.
export function ffmpegArgs({ input, out, encoder, hasAudio, width, height }) {
  const { hd, sd } = sizes(width, height);
  const video = (cq) =>
    encoder === 'nvenc'
      ? ['-c:v', 'h264_nvenc', '-preset', 'p5', '-rc', 'vbr', '-cq', String(cq), '-b:v', '0']
      : ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', String(cq - 2)];
  const hls = (dir) => [
    '-f',
    'hls',
    '-hls_time',
    '6',
    '-hls_playlist_type',
    'vod',
    '-hls_segment_filename',
    `${out}/${dir}/seg_%05d.ts`,
    `${out}/${dir}/index.m3u8`,
  ];
  const quality = (s, rate, cq, audioRate) => [
    '-map',
    '0:v:0',
    ...(hasAudio ? ['-map', '0:a:0'] : []),
    '-vf',
    `scale=${s.width}:${s.height}`,
    ...video(cq),
    '-maxrate',
    rate,
    '-bufsize',
    `${parseInt(rate, 10) * 2}k`,
    '-pix_fmt',
    'yuv420p',
    '-profile:v',
    'main',
    '-force_key_frames',
    'expr:gte(t,n_forced*6)',
    '-sc_threshold',
    '0',
    ...(hasAudio ? ['-c:a', 'aac', '-b:a', audioRate, '-ac', '2'] : []),
  ];
  return [
    '-hide_banner',
    '-nostats',
    '-y',
    '-progress',
    'pipe:1',
    '-i',
    input,
    ...quality(hd, '1800k', 25, '96k'),
    ...hls('720p'),
    ...quality(sd, '600k', 28, '64k'),
    ...hls('360p'),
    ...(hasAudio ? ['-map', '0:a:0', '-vn', '-c:a', 'aac', '-b:a', '64k', '-ac', '2', ...hls('audio')] : []),
  ];
}

// The list the site's player opens (same shape as live replays, so Listen only works too).
export function masterPlaylist({ width, height, hasAudio }) {
  const { hd, sd } = sizes(width, height);
  return [
    '#EXTM3U',
    '#EXT-X-VERSION:3',
    ...(hasAudio
      ? [
          '#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="listen",NAME="Listen only",DEFAULT=NO,AUTOSELECT=NO,URI="audio/index.m3u8"',
        ]
      : []),
    `#EXT-X-STREAM-INF:BANDWIDTH=1900000,RESOLUTION=${hd.width}x${hd.height},CODECS="avc1.4d401f${hasAudio ? ',mp4a.40.2' : ''}"`,
    '720p/index.m3u8',
    `#EXT-X-STREAM-INF:BANDWIDTH=700000,RESOLUTION=${sd.width}x${sd.height},CODECS="avc1.4d401e${hasAudio ? ',mp4a.40.2' : ''}"`,
    '360p/index.m3u8',
    '',
  ].join('\n');
}

// "12 min", "3 h 10 min" for the window.
export function duration(s) {
  if (!Number.isFinite(s) || s < 0) return '?';
  const m = Math.round(s / 60);
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`;
}
