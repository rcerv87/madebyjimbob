#!/usr/bin/env node
// Bring an existing newsletter list into the site's email list (MBJ-107): the people who accepted email marketing
// in Shopify (Customers → Export → All customers → CSV for Excel).
//
// Usage:
//   npm run import:newsletter -- <customers.csv>            your local database
//   npm run import:newsletter -- <customers.csv> --live     the live site (RENDER_DATABASE_URL)
//   … --source <name>                                       where the list is from (default: shopify)
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../../.env') });

const args = process.argv.slice(2);
const live = args.includes('--live');
const sourceAt = args.indexOf('--source');
const source = sourceAt >= 0 ? args[sourceAt + 1] : 'shopify';
const file = args.find((a, i) => !a.startsWith('--') && i !== sourceAt + 1);
if (!file || !fs.existsSync(file)) {
  console.error('Usage: npm run import:newsletter -- <customers.csv> [--live] [--source shopify]');
  process.exit(1);
}
if (live) {
  if (!process.env.RENDER_DATABASE_URL) {
    console.error('RENDER_DATABASE_URL is not set in .env.');
    process.exit(1);
  }
  process.env.DATABASE_URL = process.env.RENDER_DATABASE_URL;
  process.env.PGSSL = 'true';
}

const { pool } = await import('../src/db.js');
const { importContacts, emailListSummary } = await import('../src/emailList.js');
try {
  const r = await importContacts(fs.readFileSync(file, 'utf8'), source);
  const s = await emailListSummary();
  console.log(
    `${r.added} added, ${r.updated} already there, ${r.skipped} skipped (no email, didn't accept marketing, or unsubscribed here).`,
  );
  console.log(`The list now has ${s.total} people (${live ? 'live' : 'local'}).`);
} catch (err) {
  console.error(err.message);
  process.exitCode = 1;
}
await pool.end();
