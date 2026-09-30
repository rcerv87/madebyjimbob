#!/usr/bin/env node
// Applies pending migrations from server/migrations. Render runs this as the pre-deploy command.
//   npm run migrate            apply everything pending
//   npm run migrate -- down    roll back the most recent migration
import { migrate, pool } from '../src/db.js';

const direction = process.argv[2] === 'down' ? 'down' : 'up';
try {
  const ran = await migrate({ direction, log: console.log });
  if (ran.length) console.log(`Applied ${ran.length} migration(s) ${direction}.`);
  else console.log(direction === 'up' ? 'Database is up to date.' : 'Nothing to roll back.');
} finally {
  await pool.end();
}
