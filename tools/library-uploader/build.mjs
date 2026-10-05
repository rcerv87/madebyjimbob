// Builds the folder to put on JimBob's PC: the uploader, a copy of Node, ffmpeg and ffprobe, and a double-click
// starter. Nothing to install there.
//   node tools/library-uploader/build.mjs --ffmpeg <folder with ffmpeg.exe and ffprobe.exe> [--out <folder>]
// → <out>/MADEbyJIMBOB Library Uploader/ and a .zip of it next to it.
import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const arg = (name) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : null;
};
const ffDir = arg('ffmpeg');
if (
  !ffDir ||
  !fs.existsSync(path.join(ffDir, 'ffmpeg.exe')) ||
  !fs.existsSync(path.join(ffDir, 'ffprobe.exe'))
) {
  console.error(
    'Pass --ffmpeg <folder> holding ffmpeg.exe and ffprobe.exe (e.g. a gyan.dev "essentials" build).',
  );
  process.exit(1);
}
const outRoot = arg('out') || path.join(HERE, 'dist');
const name = 'MADEbyJIMBOB Library Uploader';
const out = path.join(outRoot, name);
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(path.join(out, 'app', 'ffmpeg'), { recursive: true });

for (const f of ['uploader.mjs', 'zip.mjs', 'lib.mjs'])
  fs.copyFileSync(path.join(HERE, f), path.join(out, 'app', f));
fs.writeFileSync(path.join(out, 'app', 'package.json'), '{ "type": "module" }\n');
fs.copyFileSync(process.execPath, path.join(out, 'app', 'node.exe'));
for (const f of ['ffmpeg.exe', 'ffprobe.exe'])
  fs.copyFileSync(path.join(ffDir, f), path.join(out, 'app', 'ffmpeg', f));

fs.writeFileSync(
  path.join(out, `Start ${name}.bat`),
  [
    '@echo off',
    `title ${name}`,
    'cd /d "%~dp0app"',
    ':run',
    'node.exe uploader.mjs %*',
    'echo.',
    'echo The uploader stopped. Starting it again in 30 seconds (close this window to stop it).',
    'timeout /t 30 >nul',
    'goto run',
    '',
  ].join('\r\n'),
);
fs.writeFileSync(
  path.join(out, 'READ ME.txt'),
  [
    'MADEbyJIMBOB Library Uploader',
    '',
    '1. Put your Google Takeout .zip files (as downloaded, not unzipped) in a folder named "MADEbyJIMBOB Library"',
    '   on your drive. OBS recordings can go in there too.',
    `2. Double-click "Start ${name}". The first time it asks for your MADEbyJIMBOB username and password.`,
    '3. Leave the window open. It makes the versions the site plays and uploads them, one video at a time, and',
    '   shows what it is doing. You can close it any time; it picks up where it left off next time.',
    '4. New files dropped in the folder later are picked up too (it checks every 10 minutes).',
    '',
    'Videos it cannot match to a YouTube video are listed in "needs-review.txt" in the folder. Send that to Ruben.',
    'Keep the drive: it is your full-quality backup.',
    '',
  ].join('\r\n'),
);

const zip = path.join(outRoot, `${name}.zip`);
fs.rmSync(zip, { force: true });
const ps = spawnSync(
  'powershell',
  ['-NoProfile', '-Command', `Compress-Archive -Path '${out}' -DestinationPath '${zip}' -Force`],
  { stdio: 'inherit' },
);
if (ps.status !== 0) process.exit(ps.status || 1);
const mb = (fs.statSync(zip).size / 1e6).toFixed(0);
console.log(`Built ${out}\n  and ${zip} (${mb} MB)`);
