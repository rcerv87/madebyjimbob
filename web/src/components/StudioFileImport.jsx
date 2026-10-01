import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, formatTime } from '../api.js';
import { tusUpload } from './StudioVideoActions.jsx';

const VIDEO_EXT = /\.(mp4|m4v|mov|mkv|webm|avi|flv|wmv|mpe?g|ts)$/i;
const JIMBOB = 'https://www.youtube.com/@madebyjimbob';

// Titles as files name them: lower case, letters and digits only. Takeout adds " (1)" to repeats.
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

// Takeout's video metadata CSV → Map(normalized title → YouTube id). Finds the id and title columns by name.
export function takeoutIds(text) {
  const rows = parseCsv(text);
  const head = (rows[0] || []).map((h) => h.toLowerCase());
  const idCol = head.findIndex((h) => h.includes('video id'));
  const titleCol = head.findIndex((h) => h.includes('title'));
  const map = new Map();
  if (idCol < 0 || titleCol < 0) return map;
  for (const r of rows.slice(1)) {
    const id = (r[idCol] || '').trim();
    if (/^[\w-]{11}$/.test(id)) map.set(normTitle(r[titleCol]), id);
  }
  return map;
}

// A small file's text (older browsers lack File.text()).
const readText = (file) =>
  typeof file.text === 'function'
    ? file.text()
    : new Promise((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(String(r.result));
        r.onerror = () => reject(r.error);
        r.readAsText(file);
      });

// Which YouTube video a file is: an [id] in the name (yt-dlp), Takeout's CSV, or a unique title on the channel.
export function matchFile(name, { csv, byTitle }) {
  const inName = name.match(/\[([\w-]{11})\]/)?.[1];
  if (inName) return inName;
  const key = normTitle(name);
  if (csv.has(key)) return csv.get(key);
  const same = byTitle.get(key);
  return same?.length === 1 ? same[0].youtubeId : null;
}

// Studio → Add videos → From files (MBJ-701; the Takeout path of MBJ-806): files you already have go straight
// to Cloudflare; new videos get their title, chat, and comments from the helper (no download), and videos already
// on the site get the better file swapped in.
export default function StudioFileImport({ tier, withComments, onQueued }) {
  const [channel, setChannel] = useState(null); // Map youtubeId → channel video
  const [channelNote, setChannelNote] = useState('');
  const [rows, setRows] = useState([]);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState('');

  // The whole channel list, to match files by title and know what's already on the site.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const all = new Map();
      let offset = 0;
      for (;;) {
        const d = await api(
          `/studio/channel?url=${encodeURIComponent(JIMBOB)}&show=all&limit=500&offset=${offset}`,
        );
        for (const v of d.videos) all.set(v.youtubeId, v);
        offset += d.videos.length;
        if (!d.videos.length || offset >= d.total) {
          if (!d.listing || d.listing.status !== 'done')
            setChannelNote('Get the channel list (From the channel) so files can be matched by title.');
          break;
        }
      }
      if (!cancelled) setChannel(all);
    })().catch((e) => !cancelled && setChannelNote(e.message));
    return () => {
      cancelled = true;
    };
  }, []);

  const byTitle = useMemo(() => {
    const m = new Map();
    for (const v of channel?.values() || []) {
      const k = normTitle(v.title);
      m.set(k, [...(m.get(k) || []), v]);
    }
    return m;
  }, [channel]);

  const describe = (youtubeId) => {
    const v = youtubeId && channel?.get(youtubeId);
    const action = !youtubeId
      ? 'unmatched'
      : v?.state === 'onsite'
        ? 'replace'
        : v?.state === 'queued'
          ? 'skip'
          : 'import';
    return { youtubeId, video: v || null, action, use: action === 'import' || action === 'replace' };
  };

  const pick = (fileList) =>
    choose(fileList).catch((err) => setError(`Couldn’t read those files: ${err.message}`));
  const choose = async (fileList) => {
    setError('');
    const files = [...fileList];
    let csv = new Map();
    for (const f of files.filter((f) => /\.csv$/i.test(f.name))) {
      const found = takeoutIds(await readText(f));
      if (found.size) csv = new Map([...csv, ...found]);
    }
    const videos = files.filter((f) => VIDEO_EXT.test(f.name) || f.type.startsWith('video/'));
    if (!videos.length)
      return setError('No video files there. Pick .mp4, .mov, .mkv, or .webm files (or a folder).');
    setRows(
      videos.map((file) => ({
        key: `${file.name}-${file.size}`,
        file,
        ...describe(matchFile(file.name, { csv, byTitle })),
        status: '',
      })),
    );
  };

  const setLink = (key, link) => {
    const id =
      link.match(/(?:v=|youtu\.be\/|live\/|shorts\/)([\w-]{11})/)?.[1] ||
      (/^[\w-]{11}$/.test(link) ? link : null);
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...describe(id), status: '' } : r)));
  };
  const toggle = (key) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, use: !r.use } : r)));
  const update = (key, patch) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  const chosen = rows.filter(
    (r) => r.use && (r.action === 'import' || r.action === 'replace') && r.status !== 'done',
  );
  const minutes = Math.round(chosen.reduce((sum, r) => sum + (r.video?.durationS || 0), 0) / 60);

  // Leaving mid-upload would lose it.
  useEffect(() => {
    if (!running) return undefined;
    const warn = (e) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [running]);

  const start = async () => {
    setRunning(true);
    setError('');
    for (const r of chosen) {
      try {
        update(r.key, { status: 'Uploading 0%' });
        const name = r.video?.title || r.file.name;
        const progress = (p) => update(r.key, { status: `Uploading ${Math.round(p * 100)}%` });
        if (r.action === 'replace') {
          const { uploadUrl } = await api(`/studio/videos/${r.video.videoId}/replacement`, {
            method: 'POST',
            body: { size: r.file.size, name },
          });
          await tusUpload(uploadUrl, r.file, progress);
          update(r.key, {
            status: 'done',
            note: 'Uploaded. It replaces the site’s copy once Cloudflare has processed it.',
          });
        } else {
          const { job, uploadUrl } = await api('/studio/imports/file', {
            method: 'POST',
            body: { video: r.youtubeId, size: r.file.size, name, tier, withComments },
          });
          await tusUpload(uploadUrl, r.file, progress);
          await api(`/studio/imports/${job.id}/uploaded`, { method: 'POST' });
          update(r.key, { status: 'done', note: 'Uploaded. The helper adds its title, chat, and comments.' });
        }
      } catch (err) {
        update(r.key, { status: 'error', note: err.message });
        if (/CF_ACCOUNT_ID/.test(err.message)) {
          setError(err.message);
          break;
        }
      }
    }
    setRunning(false);
    onQueued?.();
  };

  const counts = rows.reduce((c, r) => ({ ...c, [r.action]: (c[r.action] || 0) + 1 }), {});
  return (
    <div className="file-import">
      <p className="small muted">
        Pick video files you already have, or JimBob’s whole Google Takeout folder (its videos.csv matches
        each file to its YouTube video exactly). Files go straight to Cloudflare; new videos get their title,
        chat, and comments from the helper, and videos already on the site get the better file swapped in.
      </p>
      <div className="file-pickers">
        <label className="text-btn file-pick">
          Pick files
          <input type="file" multiple accept="video/*,.csv" hidden onChange={(e) => pick(e.target.files)} />
        </label>
        <label className="text-btn file-pick">
          Pick a folder (Takeout)
          <input type="file" hidden webkitdirectory="" multiple onChange={(e) => pick(e.target.files)} />
        </label>
      </div>
      {channelNote && <p className="small muted">{channelNote}</p>}

      {rows.length > 0 && (
        <>
          <p className="small">
            {rows.length} file{rows.length === 1 ? '' : 's'}: {counts.import || 0} new, {counts.replace || 0}{' '}
            already on the site (replace), {counts.skip || 0} already queued, {counts.unmatched || 0} not
            matched.
          </p>
          <ul className="channel-list file-list">
            {rows.map((r) => (
              <li key={r.key}>
                <input
                  type="checkbox"
                  checked={r.use}
                  disabled={
                    running || r.status === 'done' || !(r.action === 'import' || r.action === 'replace')
                  }
                  onChange={() => toggle(r.key)}
                  aria-label={`Use ${r.file.name}`}
                />
                <div className="channel-item">
                  <span className="file-name">{r.file.name}</span>
                  <span className="muted small">
                    {(r.file.size / 1024 ** 3).toFixed(2)} GB
                    {r.video?.durationS ? ` · ${formatTime(r.video.durationS)}` : ''}
                  </span>
                  {r.youtubeId ? (
                    <span className="small">
                      →{' '}
                      <a
                        href={`https://www.youtube.com/watch?v=${r.youtubeId}`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {r.video?.title || r.youtubeId}
                      </a>{' '}
                      {r.action === 'replace' && (
                        <Link className="badge ok" to={`/watch/${r.video.videoId}`}>
                          On the site: replace its copy
                        </Link>
                      )}
                      {r.action === 'skip' && <span className="badge">Already queued</span>}
                      {r.action === 'import' && <span className="badge">New</span>}
                    </span>
                  ) : (
                    <input
                      className="file-link"
                      placeholder="Not matched: paste its YouTube link"
                      aria-label={`YouTube link for ${r.file.name}`}
                      onChange={(e) => setLink(r.key, e.target.value.trim())}
                    />
                  )}
                  {r.status && r.status !== 'done' && r.status !== 'error' && (
                    <span className="small">{r.status}</span>
                  )}
                  {r.note && <span className={`small ${r.status === 'error' ? 'error' : ''}`}>{r.note}</span>}
                </div>
              </li>
            ))}
          </ul>
          <div className="channel-queue">
            <button className="primary-btn" disabled={!chosen.length || running} onClick={start}>
              {running
                ? 'Uploading… keep this page open'
                : `Upload ${chosen.length} file${chosen.length === 1 ? '' : 's'}`}
            </button>
            {minutes > 0 && (
              <span className="small muted">
                Adds about {minutes.toLocaleString()} minutes to Cloudflare Stream storage (the Starter plan
                includes 1,000).
              </span>
            )}
          </div>
        </>
      )}
      {error && <p className="error small">{error}</p>}
    </div>
  );
}
