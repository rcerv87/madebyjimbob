import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';
import { runner } from 'node-pg-migrate';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// npm workspaces run scripts from server/, but .env lives at the repo root.
dotenv.config({ path: path.join(__dirname, '../../.env') });

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is not set. Copy .env.example to .env at the repo root and fill it in.');
  process.exit(1);
}

const connection = {
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.PGSSL === 'true' ? { rejectUnauthorized: false } : false,
};

export const pool = new pg.Pool({ ...connection, max: 10 });

// Applies pending migrations from server/migrations. Returns the migrations that ran.
export function migrate({ direction = 'up', log = () => {} } = {}) {
  return runner({
    databaseUrl: connection,
    dir: path.join(__dirname, '../migrations'),
    migrationsTable: 'pgmigrations',
    direction,
    count: direction === 'up' ? Infinity : 1,
    checkOrder: true,
    log,
  });
}
