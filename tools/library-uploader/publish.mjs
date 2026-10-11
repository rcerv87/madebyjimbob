// Puts the built uploader (.zip from build.mjs) in the library bucket, where Studio → Library uploader hands out
// a download link for it. Uses the same storage settings as the site (LIBRARY_R2_*, else R2_*) from .env.
//   node tools/library-uploader/publish.mjs [--zip <file>]
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
// library.js loads .env (through db.js).
const { allStores, UPLOADER_KEY } = await import('../../server/src/library.js');
const { presign } = await import('../../server/live-recorder/r2put.mjs');

const i = process.argv.indexOf('--zip');
const zip = i > 0 ? process.argv[i + 1] : path.join(HERE, 'dist', 'MADEbyJIMBOB Library Uploader.zip');
if (!fs.existsSync(zip)) {
  console.error(`No file at ${zip}. Build it first: node tools/library-uploader/build.mjs --ffmpeg <folder>`);
  process.exit(1);
}
// Every bucket in .env (the library's and the site's own): the live site looks in whichever it's set up with.
const stores = allStores();
if (!stores.length) {
  console.error('Library storage isn’t set up: LIBRARY_R2_* (or R2_*) in .env.');
  process.exit(1);
}

const body = fs.readFileSync(zip);
const mb = (body.length / 1e6).toFixed(0);
for (const store of stores) {
  console.log(`Uploading ${mb} MB to ${store.bucket} (${new URL(store.publicUrl).host})…`);
  const res = await fetch(presign(store, 'PUT', UPLOADER_KEY, 3600), {
    method: 'PUT',
    headers: { 'content-type': 'application/zip' },
    body,
    signal: AbortSignal.timeout(30 * 60 * 1000),
  });
  if (!res.ok) {
    console.error(`Upload failed: ${res.status} ${(await res.text()).slice(0, 300)}`);
    process.exit(1);
  }
}
console.log('Done. Studio → Library uploader now offers this version.');
process.exit(0);
