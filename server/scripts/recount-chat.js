#!/usr/bin/env node
// Rebuild every video's chat count from its messages (the triggers keep it right; this is the repair).
//
// Usage:
//   npm run recount-chat            your local database
//   npm run recount-chat -- --live  the live site (RENDER_DATABASE_URL)
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../../.env') });

const live = process.argv.includes('--live');
if (live) {
  if (!process.env.RENDER_DATABASE_URL) {
    console.error('RENDER_DATABASE_URL is not set in .env.');
    process.exit(1);
  }
  process.env.DATABASE_URL = process.env.RENDER_DATABASE_URL;
  process.env.PGSSL = 'true';
}

const { pool } = await import('../src/db.js');
const { recountChat } = await import('../src/chatCounts.js');
const fixed = await recountChat();
if (!fixed.length) console.log(`Every video's chat count was already right (${live ? 'live' : 'local'}).`);
for (const f of fixed) console.log(`Video ${f.videoId}: ${f.was} → ${f.now}`);
await pool.end();
