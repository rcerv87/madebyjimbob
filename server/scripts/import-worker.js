#!/usr/bin/env node
// The import helper (MBJ-701): runs on Ruben's PC, picks up YouTube links queued in Studio → Add videos, and
// imports each one with scripts/import-youtube.js (video to Cloudflare Stream, chat replay and comments to the
// database). Studio shows each step. Leave it running while importing; Ctrl+C puts an unfinished job back.
// It also lists channels for Studio's "From the channel" (MBJ-706) when the server has no YouTube API key.
//
// Usage:
//   npm run import:worker              the live site (RENDER_DATABASE_URL from .env)
//   npm run import:worker -- --local   your local database (DATABASE_URL)
//
// Needs yt-dlp and ffmpeg (C:\Users\office\tools\bin is added to PATH if it exists; or set IMPORT_TOOLS_DIR),
// and CF_ACCOUNT_ID / CF_API_TOKEN in .env for uploads.
import os from 'os';
import fs from 'fs';
import path from 'path';
import readline from 'readline';
import { spawn, execFile } from 'child_process';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../../.env') });

const local = process.argv.includes('--local');
const target = local ? process.env.DATABASE_URL : process.env.RENDER_DATABASE_URL;
if (!target) {
  console.error(
    local
      ? 'DATABASE_URL is not set in .env.'
      : 'RENDER_DATABASE_URL is not set in .env (Render → database → External URL).',
  );
  process.exit(1);
}
// Everything below (and every import it runs) uses the chosen database.
process.env.DATABASE_URL = target;
if (!local) process.env.PGSSL = 'true';

const { pool } = await import('../src/db.js');
const { heartbeat, claimNext, reportStep, finishJob, requeueRunning } = await import('../src/imports.js');
const { claimNextListing, saveListing, failListing, parseTab, CHANNEL_TABS } =
  await import('../src/channel.js');

const NAME = `${os.hostname()}`;
const toolsDir = process.env.IMPORT_TOOLS_DIR || 'C:\\Users\\office\\tools\\bin';
const PATH = fs.existsSync(toolsDir) ? `${toolsDir}${path.delimiter}${process.env.PATH}` : process.env.PATH;

let current = null;
let stopping = false;

// The import script's output, turned into a short step for Studio.
const STEPS = [
  [/^Reading video info/, 'Reading video info'],
  [/^Downloading chat replay/, 'Downloading chat replay'],
  [/^Downloading comments/, 'Downloading comments'],
  [/^Downloading video/, 'Downloading video'],
  [/^Uploading to Cloudflare Stream/, 'Uploading to Cloudflare'],
  [/^Imported \d+ new chat/, null],
  [/^Imported \d+ comments/, null],
];

function runImport(job) {
  return new Promise((resolve) => {
    const args = ['scripts/import-youtube.js', job.url, '--tier', job.tier];
    if (!job.withComments) args.push('--no-comments');
    const child = spawn(process.execPath, args, {
      cwd: path.join(__dirname, '..'),
      env: { ...process.env, PATH, IMPORT_SKIP_MIGRATE: '1' },
    });
    current = { job, child };
    const tail = [];
    const errors = []; // yt-dlp's "ERROR: …" lines, which say what actually went wrong
    let videoId = null;
    let afterInfo = false;
    const onLine = async (line) => {
      const text = line.trim();
      if (!text) return;
      tail.push(text);
      if (tail.length > 8) tail.shift();
      const err = text.match(/ERROR: (.*?)(?:\\n)?'?,?$/);
      if (err && !errors.includes(err[1])) errors.push(err[1]);
      console.log(`  [#${job.id}] ${text}`);
      if (afterInfo && /\([A-Za-z0-9_-]{11}\)$/.test(text)) {
        afterInfo = false;
        await reportStep(job.id, { title: text.replace(/\s*\([A-Za-z0-9_-]{11}\)$/, '') }).catch(() => {});
        return;
      }
      if (text.startsWith('Reading video info')) afterInfo = true;
      const saved = text.match(/^Video saved as #(\d+)/);
      if (saved) {
        videoId = Number(saved[1]);
        await reportStep(job.id, { step: 'Saving chat and comments', videoId }).catch(() => {});
        return;
      }
      for (const [re, step] of STEPS) {
        if (re.test(text)) {
          await reportStep(job.id, { step: step || text }).catch(() => {});
          return;
        }
      }
    };
    readline.createInterface({ input: child.stdout }).on('line', onLine);
    readline.createInterface({ input: child.stderr }).on('line', onLine);
    child.on('close', (code) => {
      current = null;
      resolve({
        ok: code === 0,
        videoId,
        error: code === 0 ? null : errors.join('\n') || tail.join('\n') || `Exited with ${code}`,
      });
    });
  });
}

// One channel tab (videos, streams, shorts) as a flat list; a channel without that tab is just empty.
function listTab(channelUrl, tab) {
  return new Promise((resolve, reject) => {
    execFile(
      'yt-dlp',
      [
        '--flat-playlist',
        '-J',
        '--no-warnings',
        '--extractor-args',
        'youtubetab:approximate_date',
        `${channelUrl}/${tab}`,
      ],
      { env: { ...process.env, PATH }, maxBuffer: 1024 * 1024 * 256, windowsHide: true },
      (err, stdout, stderr) => {
        if (!err) return resolve(parseTab(JSON.parse(stdout), tab));
        if (/does not have a .* tab/i.test(stderr)) return resolve([]);
        reject(new Error(stderr.match(/ERROR: (.*)/)?.[1] || err.message));
      },
    );
  });
}

async function runListing(listing) {
  console.log(`Listing ${listing.channel_url}…`);
  try {
    const entries = [];
    const seen = new Set();
    for (const tab of CHANNEL_TABS) {
      for (const e of await listTab(listing.channel_url, tab)) {
        if (seen.has(e.youtubeId)) continue;
        seen.add(e.youtubeId);
        entries.push(e);
      }
    }
    await saveListing(listing.id, entries);
    console.log(`Listed ${entries.length} videos on ${listing.channel_url}.`);
  } catch (err) {
    await failListing(listing.id, err.message);
    console.log(`Couldn't list ${listing.channel_url}: ${err.message}`);
  }
}

async function loop() {
  const back = await requeueRunning();
  if (back) console.log(`Put ${back} unfinished import(s) back in the queue.`);
  console.log(
    `Import helper running on ${NAME} against the ${local ? 'local' : 'live'} database. Ctrl+C to stop.`,
  );
  while (!stopping) {
    await heartbeat(NAME).catch((err) => console.error('Heartbeat failed:', err.message));
    // Channel lists first: they take seconds and someone is waiting on the screen.
    const listing = await claimNextListing().catch(() => null);
    if (listing) {
      await runListing(listing);
      continue;
    }
    const job = await claimNext().catch((err) => {
      console.error('Could not check the queue:', err.message);
      return null;
    });
    if (!job) {
      await new Promise((r) => setTimeout(r, 10_000));
      continue;
    }
    console.log(`Importing #${job.id}: ${job.url}`);
    const beat = setInterval(() => heartbeat(NAME, job.id).catch(() => {}), 15_000);
    const result = await runImport(job);
    clearInterval(beat);
    if (stopping) break;
    await finishJob(job.id, result);
    console.log(result.ok ? `Done #${job.id}.` : `Failed #${job.id}: ${result.error.split('\n').pop()}`);
  }
}

process.on('SIGINT', async () => {
  if (stopping) process.exit(1);
  stopping = true;
  console.log('\nStopping…');
  // Never hang on the way out (a slow database connection could keep pool.end() waiting).
  setTimeout(() => process.exit(0), 3000).unref();
  if (current) {
    current.child.kill();
    await requeueRunning().catch(() => {});
  }
  await pool.end().catch(() => {});
  process.exit(0);
});

await loop();
await pool.end();
