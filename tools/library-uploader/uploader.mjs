// MADEbyJIMBOB Library Uploader (MBJ-818). Runs on JimBob's PC: watches the "MADEbyJIMBOB Library" folder (his
// Google Takeout .zip files, as downloaded, plus any OBS recordings), and for each video makes the versions the site
// plays (720p, 360p, audio only), uploads them to the site's video storage, and tells the site. It picks up where it
// left off after a restart, and keeps watching for new files. No storage keys here: the site hands out a short-lived
// link for each file.
//
//   Start MADEbyJIMBOB Library Uploader.bat   (double-click; asks for the site sign-in the first time)
//   node uploader.mjs [--folder <path>] [--site <url>] [--once]
import fs from 'fs';
import os from 'os';
import path from 'path';
import readline from 'readline';
import { spawn, spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import { listZip, readZipText, extractZipEntry } from './zip.mjs';
import {
  VIDEO,
  isMetadataCsv,
  takeoutIds,
  normTitle,
  matchFile,
  fileKey,
  ffmpegArgs,
  masterPlaylist,
  duration,
} from './lib.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FOLDER_NAME = 'MADEbyJIMBOB Library';
const STATE_FILE = '.madebyjimbob-uploader.json';
const WORK_DIR = '.uploader-work';
const RESCAN_MIN = 10;
const PARALLEL = 6;

const arg = (name) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : null;
};
const has = (name) => process.argv.includes(`--${name}`);
const configDir = path.join(process.env.APPDATA || os.homedir(), 'MADEbyJIMBOB Uploader');
const configFile = path.join(configDir, 'config.json');
const loadJson = (f, fallback) => {
  try {
    return JSON.parse(fs.readFileSync(f, 'utf8'));
  } catch {
    return fallback;
  }
};
const saveJson = (f, data) => {
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(`${f}.tmp`, JSON.stringify(data, null, 2));
  fs.renameSync(`${f}.tmp`, f);
};
const config = loadJson(configFile, {});
const SITE = (arg('site') || config.site || 'https://madebyjimbob.onrender.com').replace(/\/+$/, '');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const now = () => new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
const say = (...a) => console.log(`${now()}  ${a.join(' ')}`);
let statusLine = '';
const status = (text) => {
  statusLine = text;
  if (process.stdout.isTTY)
    process.stdout.write(`\r${text.slice(0, (process.stdout.columns || 100) - 1).padEnd(statusLine.length)}`);
};
const endStatus = () => {
  if (process.stdout.isTTY && statusLine) process.stdout.write('\n');
  statusLine = '';
};

// ---------- the site ----------

async function api(p, { method = 'GET', body } = {}) {
  const res = await fetch(`${SITE}/api${p}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      Origin: SITE,
      ...(config.token && { Authorization: `Bearer ${config.token}` }),
    },
    body: body && JSON.stringify(body),
    signal: AbortSignal.timeout(60000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok)
    throw Object.assign(new Error(data.error || `The site answered ${res.status}`), { status: res.status });
  return { data, res };
}

function ask(question, { hidden = false } = {}) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    if (hidden) {
      const write = rl._writeToOutput.bind(rl);
      rl._writeToOutput = (s) => write(s.startsWith(question) ? s : s.replace(/[^\r\n]/g, '•'));
    }
    rl.question(question, (a) => {
      rl.close();
      if (hidden) process.stdout.write('\n');
      resolve(a.trim());
    });
  });
}

async function signIn() {
  for (;;) {
    if (config.token) {
      const me = await api('/me').catch(() => null);
      const user = me?.data?.user || me?.data;
      if (user?.isAdmin) return user;
      if (user)
        console.log(
          `Signed in as ${user.username}, but that account can't add videos. Use JimBob's account.`,
        );
    }
    console.log(`\nSign in with your MADEbyJIMBOB account (${SITE}).`);
    const username = await ask('Username or email: ');
    const password = await ask('Password: ', { hidden: true });
    const isEmail = username.includes('@');
    const r = await fetch(`${SITE}/api/auth/sign-in/${isEmail ? 'email' : 'username'}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: SITE },
      body: JSON.stringify(isEmail ? { email: username, password } : { username, password }),
    });
    const token = r.headers.get('set-auth-token');
    if (!r.ok || !token) {
      console.log('That username and password didn’t work. Try again.');
      continue;
    }
    config.token = token;
    saveJson(configFile, { ...config, site: SITE });
  }
}

// ---------- the folder ----------

function findFolder() {
  const given = arg('folder') || config.folder;
  if (given && fs.existsSync(given)) return given;
  const candidates = [];
  for (let c = 67; c <= 90; c += 1) candidates.push(`${String.fromCharCode(c)}:\\${FOLDER_NAME}`);
  candidates.push(path.join(os.homedir(), 'Desktop', FOLDER_NAME), path.join(os.homedir(), FOLDER_NAME));
  return candidates.find((p) => {
    try {
      return fs.statSync(p).isDirectory();
    } catch {
      return false;
    }
  });
}

function walk(dir, out = []) {
  for (const d of fs.readdirSync(dir, { withFileTypes: true })) {
    if (d.name === WORK_DIR || d.name.startsWith('.')) continue;
    const p = path.join(dir, d.name);
    if (d.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

// Everything in the folder: videos (inside zips or loose) and Takeout's metadata CSVs.
async function scan(folder) {
  const videos = [];
  const csv = new Map();
  for (const file of walk(folder)) {
    const rel = path.relative(folder, file);
    if (/\.zip$/i.test(file)) {
      let entries;
      try {
        entries = await listZip(file);
      } catch (err) {
        say(`Skipping ${rel}: ${err.message}`);
        continue;
      }
      for (const e of entries) {
        if (isMetadataCsv(e.name))
          for (const [k, v] of takeoutIds(await readZipText(file, e).catch(() => ''))) csv.set(k, v);
        else if (VIDEO.test(e.name))
          videos.push({ key: fileKey(rel, e.name, e.size), name: e.name, size: e.size, zip: file, entry: e });
      }
    } else if (isMetadataCsv(file)) {
      for (const [k, v] of takeoutIds(fs.readFileSync(file, 'utf8'))) csv.set(k, v);
    } else if (VIDEO.test(file)) {
      const { size } = fs.statSync(file);
      videos.push({ key: fileKey('', rel, size), name: rel, size, path: file });
    }
  }
  return { videos, csv };
}

// ---------- ffmpeg ----------

const exe = (name) => {
  for (const p of [path.join(HERE, 'ffmpeg', `${name}.exe`), path.join(HERE, `${name}.exe`)])
    if (fs.existsSync(p)) return p;
  return name;
};
const FFMPEG = exe('ffmpeg');
const FFPROBE = exe('ffprobe');

function pickEncoder() {
  const test = spawnSync(FFMPEG, [
    '-hide_banner',
    '-loglevel',
    'error',
    '-f',
    'lavfi',
    '-i',
    'color=black:s=1280x720:d=1',
    '-c:v',
    'h264_nvenc',
    '-f',
    'null',
    '-',
  ]);
  return test.status === 0 ? 'nvenc' : 'x264';
}

function probe(file) {
  const r = spawnSync(FFPROBE, ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', file], {
    encoding: 'utf8',
    maxBuffer: 16 << 20,
  });
  if (r.status !== 0) throw new Error(`can't read the video (${(r.stderr || '').trim().split('\n').pop()})`);
  const j = JSON.parse(r.stdout);
  const v = j.streams.find((s) => s.codec_type === 'video');
  if (!v) throw new Error('no picture in this file');
  return {
    width: v.width,
    height: v.height,
    hasAudio: j.streams.some((s) => s.codec_type === 'audio'),
    durationS: Number(j.format.duration) || 0,
  };
}

function convert(args, totalS, onProgress) {
  return new Promise((resolve, reject) => {
    const ff = spawn(FFMPEG, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let err = '';
    ff.stderr.on('data', (d) => (err = (err + d).slice(-4000)));
    ff.stdout.on('data', (d) => {
      const t = String(d).match(/out_time_us=(\d+)/g);
      if (t && totalS) onProgress(Math.min(1, Number(t.at(-1).split('=')[1]) / 1e6 / totalS));
    });
    ff.on('error', reject);
    ff.on('close', (code) =>
      code === 0 ? resolve() : reject(new Error(`ffmpeg failed: ${err.trim().split('\n').pop()}`)),
    );
  });
}

// ---------- upload ----------

async function putFile(url, file, type) {
  for (let attempt = 1; ; attempt += 1) {
    try {
      const body = fs.readFileSync(file);
      const res = await fetch(url, {
        method: 'PUT',
        body,
        headers: { 'Content-Type': type, 'Cache-Control': 'public, max-age=31536000, immutable' },
        signal: AbortSignal.timeout(300000),
      });
      if (!res.ok) throw new Error(`storage answered ${res.status}`);
      return body.length;
    } catch (err) {
      if (attempt >= 5) throw err;
      await sleep(2000 * attempt);
    }
  }
}

async function upload(uploadId, outDir, onProgress) {
  const files = [];
  for (const q of ['720p', '360p', 'audio']) {
    const dir = path.join(outDir, q);
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir).sort()) files.push(`${q}/${f}`);
  }
  if (fs.existsSync(path.join(outDir, 'thumb.jpg'))) files.push('thumb.jpg');
  files.push('master.m3u8'); // last: its presence tells the site everything else is there
  const type = (f) =>
    f.endsWith('.ts') ? 'video/mp2t' : f.endsWith('.jpg') ? 'image/jpeg' : 'application/vnd.apple.mpegurl';
  let done = 0;
  for (let i = 0; i < files.length; i += 300) {
    const batch = files.slice(i, i + 300);
    const last = batch.at(-1) === 'master.m3u8';
    const parts = last ? batch.slice(0, -1) : batch;
    const { data } = await api(`/studio/library/uploads/${uploadId}/sign`, {
      method: 'POST',
      body: { paths: batch },
    });
    let next = 0;
    await Promise.all(
      Array.from({ length: PARALLEL }, async () => {
        while (next < parts.length) {
          const f = parts[next++];
          await putFile(data.urls[f], path.join(outDir, f), type(f));
          onProgress(++done / files.length);
        }
      }),
    );
    if (last) {
      await putFile(data.urls['master.m3u8'], path.join(outDir, 'master.m3u8'), type('master.m3u8'));
      onProgress(++done / files.length);
    }
  }
}

// ---------- one video ----------

async function processVideo(item, match, folder, n, total) {
  const label = `[${n}/${total}] ${match.title || item.name}`;
  const { data: start } = await api('/studio/library/uploads', {
    method: 'POST',
    body: { youtubeId: match.youtubeId, fileKey: item.key, title: match.title, sizeBytes: item.size },
  });
  if (start.done) return 'already on the site';
  const work = path.join(folder, WORK_DIR, match.youtubeId);
  fs.rmSync(work, { recursive: true, force: true });
  fs.mkdirSync(work, { recursive: true });
  try {
    let source = item.path;
    if (item.zip) {
      source = path.join(work, `source${path.extname(item.name) || '.mp4'}`);
      let copied = 0;
      await extractZipEntry(item.zip, item.entry, source, (b) => {
        copied += b;
        status(`${label} — unpacking ${Math.round((100 * copied) / item.size)}%`);
      });
    }
    const info = probe(source);
    const out = path.join(work, 'out');
    for (const q of ['720p', '360p', ...(info.hasAudio ? ['audio'] : [])])
      fs.mkdirSync(path.join(out, q), { recursive: true });
    const started = Date.now();
    await convert(
      ffmpegArgs({ input: source, out: out.replace(/\\/g, '/'), encoder: ENCODER, ...info }),
      info.durationS,
      (p) => {
        const left = p > 0.01 ? ((Date.now() - started) / 1000) * ((1 - p) / p) : NaN;
        status(`${label} — converting ${Math.round(p * 100)}% (about ${duration(left)} left)`);
      },
    );
    spawnSync(FFMPEG, [
      '-hide_banner',
      '-loglevel',
      'error',
      '-y',
      '-ss',
      String(Math.min(300, info.durationS * 0.1)),
      '-i',
      source,
      '-frames:v',
      '1',
      '-vf',
      'scale=640:-2',
      '-q:v',
      '4',
      path.join(out, 'thumb.jpg'),
    ]);
    fs.writeFileSync(path.join(out, 'master.m3u8'), masterPlaylist(info));
    if (item.zip) fs.rmSync(source, { force: true }); // free the space before uploading
    await upload(start.uploadId, out, (p) => status(`${label} — uploading ${Math.round(p * 100)}%`));
    const { data: fin } = await api(`/studio/library/uploads/${start.uploadId}/finish`, {
      method: 'POST',
      body: { durationS: info.durationS },
    });
    return fin.videoId
      ? 'on the site (replaced the old copy)'
      : 'uploaded; the site is adding its chat and comments';
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
}

// ---------- main ----------

let ENCODER = 'x264';

async function main() {
  console.log('MADEbyJIMBOB Library Uploader\n');
  if (spawnSync(FFMPEG, ['-version']).status !== 0) {
    console.log('ffmpeg is missing next to this program. Ask Ruben for the full uploader folder.');
    await ask('Press Enter to close.');
    return;
  }
  const user = await signIn();
  say(`Signed in as ${user.username}.`);
  let folder = findFolder();
  while (!folder) {
    const typed = await ask(`Where is the "${FOLDER_NAME}" folder? (e.g. E:\\${FOLDER_NAME}): `);
    if (typed && fs.existsSync(typed)) folder = typed;
  }
  if (config.folder !== folder) saveJson(configFile, { ...config, site: SITE, folder });
  ENCODER = pickEncoder();
  say(`Folder: ${folder}`);
  say(
    ENCODER === 'nvenc'
      ? 'Using the NVIDIA graphics card (fast).'
      : 'Using the processor (no NVIDIA card found; slower).',
  );
  const stateFile = path.join(folder, STATE_FILE);

  for (;;) {
    const state = loadJson(stateFile, { done: {}, failed: {} });
    say('Looking through the folder…');
    const { videos, csv } = await scan(folder);
    const channel = await api('/studio/library/channel')
      .then((r) => r.data.videos)
      .catch(() => []);
    const byTitle = new Map();
    for (const v of channel) {
      const k = normTitle(v.title);
      byTitle.set(k, [...(byTitle.get(k) || []), v]);
    }
    // The site remembers what's uploaded too (a fresh install or another computer skips it).
    const unknown = videos.filter((v) => !state.done[v.key]).map((v) => v.key);
    for (let i = 0; i < unknown.length; i += 1000) {
      const { data } = await api('/studio/library/uploaded', {
        method: 'POST',
        body: { fileKeys: unknown.slice(i, i + 1000) },
      }).catch(() => ({ data: { done: [] } }));
      for (const k of data.done) state.done[k] = true;
    }
    const todo = videos.filter((v) => !state.done[v.key]);
    const unmatched = [];
    say(
      `${videos.length} videos found · ${videos.length - todo.length} already uploaded · ${todo.length} to go.`,
    );
    let n = 0;
    for (const item of todo) {
      n += 1;
      const match = matchFile(item.name, { csv, byTitle });
      if (!match) {
        unmatched.push(item.name);
        continue;
      }
      try {
        const result = await processVideo(item, match, folder, n, todo.length);
        endStatus();
        say(`✓ ${match.title || item.name}: ${result}`);
        state.done[item.key] = match.youtubeId;
        delete state.failed[item.key];
      } catch (err) {
        endStatus();
        say(`✗ ${match.title || item.name}: ${err.message} (will try again next round)`);
        state.failed[item.key] = err.message;
        if (err.status === 401) {
          config.token = null;
          await signIn();
        }
      }
      saveJson(stateFile, state);
    }
    fs.writeFileSync(
      path.join(folder, 'needs-review.txt'),
      unmatched.length
        ? `These ${unmatched.length} files couldn't be matched to a YouTube video. Ruben can match them in Studio → From files.\r\n\r\n${unmatched.join('\r\n')}\r\n`
        : 'Every video file was matched.\r\n',
    );
    if (unmatched.length)
      say(`${unmatched.length} files couldn't be matched; see needs-review.txt in the folder.`);
    if (has('once')) return;
    say(`All caught up. Checking the folder again in ${RESCAN_MIN} minutes (leave this window open).`);
    await sleep(RESCAN_MIN * 60000);
  }
}

main().catch(async (err) => {
  endStatus();
  console.log(`\nSomething went wrong: ${err.message}`);
  if (!has('once')) await ask('Press Enter to close (then start the uploader again).');
  process.exit(1);
});
