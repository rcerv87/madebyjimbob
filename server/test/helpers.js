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
// test_admin@test.example is an admin once verified; signIn() verifies it.
process.env.ADMIN_EMAILS = 'test_admin@test.example,jimbob@test.example';
process.env.BETTER_AUTH_SECRET = 'test-secret-that-is-at-least-32-characters-long';
process.env.PASSWORD_LEAK_CHECK = 'off'; // no calls to Have I Been Pwned from tests
process.env.AUTH_RATE_LIMIT = 'off';
process.env.BANNED_WORDS = 'badword';
process.env.LOG_LEVEL = process.env.LOG_LEVEL_TEST || 'silent';
// Push off in tests (no real pushes), whatever the local .env has.
process.env.VAPID_PUBLIC_KEY = '';
process.env.VAPID_PRIVATE_KEY = '';
// Email off in tests (never real mail); email.test.js records sends with setTransport().
// Live streaming off unless a test turns it on with a fake Hetzner (never the real one).
process.env.OWNCAST_URL = '';
process.env.HETZNER_API_TOKEN = '';
process.env.R2_ACCOUNT_ID = '';
process.env.B2_ENDPOINT = '';
process.env.RESEND_API_KEY = '';
process.env.EMAIL_FROM = '';
process.env.RESEND_WEBHOOK_SECRET = `whsec_${Buffer.from('test-webhook-secret').toString('base64')}`;

const { pool, migrate } = await import('../src/db.js');
// The app (and Better Auth, which checks the database as soon as it loads) loads only after the test
// database is rebuilt; loading it first let that check race the rebuild and stall every request.
let server;
let wss;

export { pool };

export async function startServer() {
  await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  await migrate();
  ({ server, wss } = await import('../src/app.js'));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  return { base: `http://127.0.0.1:${port}/api`, wsUrl: `ws://127.0.0.1:${port}/ws` };
}

export async function stopServer() {
  // Live-chat sockets aren't HTTP connections, so closeAllConnections() skips them.
  for (const client of wss.clients) client.terminate();
  // fetch keeps connections alive and can open or reuse one after a single sweep, which kept server.close()
  // waiting forever (the occasional hung test file). Keep closing them until the server is down.
  const closed = new Promise((resolve) => server.close(resolve));
  server.closeAllConnections?.();
  const sweep = setInterval(() => server.closeAllConnections?.(), 50);
  await closed;
  clearInterval(sweep);
  await pool.end();
}

export function client(base) {
  return async function call(pathname, { method = 'GET', body, token } = {}) {
    // Browsers always send Origin; Better Auth refuses state-changing requests without it (CSRF).
    const headers = { 'Content-Type': 'application/json', Origin: new URL(base).origin };
    if (token) headers.Authorization = `Bearer ${token}`;
    const res = await fetch(base + pathname, { method, headers, body: body && JSON.stringify(body) });
    // Better Auth hands the session token for Bearer use in this header (bearer plugin).
    const newToken = res.headers.get('set-auth-token');
    return { status: res.status, data: await res.json().catch(() => null), token: newToken };
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

export const emailFor = (username) => `${username.toLowerCase()}@test.example`;

// Real sign-up (or sign-in when the name exists) through Better Auth; returns a Bearer token.
// Tiers can't be chosen by users, so a test tier is set straight in the database.
export async function signIn(call, username, tier = 'free', password = 'password1234') {
  let r = await call('/auth/sign-up/email', {
    method: 'POST',
    body: { email: emailFor(username), password, name: username, username },
  });
  if (r.status !== 200)
    r = await call('/auth/sign-in/username', { method: 'POST', body: { username, password } });
  if (r.status !== 200 || !r.token)
    throw new Error(`sign-in failed for ${username}: ${JSON.stringify(r.data)}`);
  await pool.query('UPDATE users SET tier = $1, email_verified = email_verified OR $2 WHERE id = $3', [
    tier,
    username === 'test_admin',
    r.data.user.id,
  ]);
  return r.token;
}

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
