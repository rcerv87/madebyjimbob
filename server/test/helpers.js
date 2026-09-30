// Shared setup for server tests. Import this before anything from src/.
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../../.env') });

const testUrl = process.env.DATABASE_URL_TEST;
if (!testUrl) {
  console.error('Set DATABASE_URL_TEST in .env to a disposable database. Tests wipe it on every run.');
  process.exit(1);
}
if (testUrl === process.env.DATABASE_URL || !/test/i.test(new URL(testUrl).pathname)) {
  console.error('DATABASE_URL_TEST must be a separate database with "test" in its name. Tests wipe it.');
  process.exit(1);
}

// Must be set before src/db.js and src/app.js load.
process.env.DATABASE_URL = testUrl;
process.env.PGSSL = process.env.PGSSL_TEST || 'false';
process.env.ADMIN_USERNAMES = 'test_admin';
process.env.ALLOW_TEST_TIERS = 'true';
process.env.BANNED_WORDS = 'badword';

const { pool, migrate } = await import('../src/db.js');
const { server } = await import('../src/app.js');

export { pool };

export async function startServer() {
  await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  await migrate();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  return { base: `http://127.0.0.1:${port}/api`, wsUrl: `ws://127.0.0.1:${port}/ws` };
}

export async function stopServer() {
  server.closeAllConnections?.();
  await new Promise((resolve) => server.close(resolve));
  await pool.end();
}

export function client(base) {
  return async function call(pathname, { method = 'GET', body, token } = {}) {
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers.Authorization = `Bearer ${token}`;
    const res = await fetch(base + pathname, { method, headers, body: body && JSON.stringify(body) });
    return { status: res.status, data: await res.json().catch(() => null) };
  };
}

let seq = 0;
export async function seedVideo({ minTier = 'free', durationS = 600 } = {}) {
  seq += 1;
  const { rows } = await pool.query(
    `INSERT INTO videos (youtube_id, title, duration_s, min_tier) VALUES ($1, $2, $3, $4) RETURNING id`,
    [`test-${seq}`, `Video ${seq}`, durationS, minTier],
  );
  return rows[0].id;
}

export async function seedChat(videoId, messages) {
  for (const m of messages) {
    seq += 1;
    await pool.query(
      `INSERT INTO chat_messages (video_id, source, external_id, author_name, body, offset_ms, hidden)
       VALUES ($1, 'youtube', $2, 'Viewer', $3, $4, $5)`,
      [videoId, `ext-${seq}`, m.body, m.offsetMs, m.hidden || false],
    );
  }
}

export async function signIn(call, username, tier = 'free', password = 'password123') {
  const r = await call('/session', { method: 'POST', body: { username, password, tier } });
  if (r.status !== 200) throw new Error(`sign-in failed for ${username}: ${JSON.stringify(r.data)}`);
  return r.data.token;
}

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
