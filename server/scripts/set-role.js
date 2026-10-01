#!/usr/bin/env node
// Give an account Studio access (or take it away).
//
// Usage:
//   npm run set-role -- <username> admin|mod|viewer          your local database
//   npm run set-role -- <username> admin|mod|viewer --live   the live site (RENDER_DATABASE_URL)
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../../.env') });

const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const live = process.argv.includes('--live');
const [username, role] = args;
if (!username || !['admin', 'mod', 'viewer'].includes(role)) {
  console.error('Usage: npm run set-role -- <username> admin|mod|viewer [--live]');
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
const { rows } = await pool.query(
  'UPDATE users SET role = $2 WHERE lower(username) = lower($1) RETURNING username, role',
  [username, role],
);
console.log(
  rows[0]
    ? `${rows[0].username} is now ${rows[0].role} (${live ? 'live' : 'local'}).`
    : `No account named ${username}.`,
);
await pool.end();
process.exit(rows[0] ? 0 : 1);
