// A member's security history (MBJ-113): sign-ins, password and email changes. Shown on /account so people
// can spot something they didn't do. Logging never breaks the action being logged.
import { pool } from './db.js';
import { logger } from './logger.js';

export async function logSecurityEvent(userId, type, { ip = null, userAgent = null, detail = null } = {}) {
  try {
    await pool.query(
      `INSERT INTO security_events (user_id, type, ip_address, user_agent, detail) VALUES ($1, $2, $3, $4, $5)`,
      [userId, type, ip, userAgent ? String(userAgent).slice(0, 400) : null, detail],
    );
  } catch (err) {
    logger.warn({ err, type }, 'security event not logged');
  }
}

// Where a request came from, for the history (our middleware sets x-mbj-client-ip from req.ip).
export function requestOrigin(headers) {
  const get = (name) => (typeof headers?.get === 'function' ? headers.get(name) : headers?.[name]);
  return { ip: get('x-mbj-client-ip') || null, userAgent: get('user-agent') || null };
}
