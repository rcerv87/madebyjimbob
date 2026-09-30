// Account email (MBJ-114, ADR-012): sent through Resend's HTTPS API from EMAIL_FROM. Every send is logged
// in `emails`; addresses that hard-bounced or reported spam are in `email_suppressions` and never get mail
// again. Callers only use sendEmail(), so moving to another provider means changing this file only.
import crypto from 'crypto';
import { pool } from './db.js';
import { logger } from './logger.js';
import { renderEmail } from './emailTemplates.js';

const { RESEND_API_KEY, EMAIL_FROM, EMAIL_REPLY_TO } = process.env;
export const emailEnabled = Boolean(RESEND_API_KEY && EMAIL_FROM);
export const emailFrom = EMAIL_FROM || null;

export function normalizeEmail(address) {
  const s = String(address ?? '')
    .trim()
    .toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s) && s.length <= 254 ? s : null;
}

// One retry (same idempotency key, so never a duplicate) for network errors, rate limits, and 5xx.
async function resend(msg) {
  const idempotencyKey = crypto.randomUUID();
  for (let attempt = 1; ; attempt += 1) {
    let res;
    try {
      res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${RESEND_API_KEY}`,
          'Content-Type': 'application/json',
          'Idempotency-Key': idempotencyKey,
        },
        body: JSON.stringify({
          from: EMAIL_FROM,
          to: [msg.to],
          subject: msg.subject,
          html: msg.html,
          text: msg.text,
          ...(EMAIL_REPLY_TO ? { reply_to: EMAIL_REPLY_TO } : {}),
          tags: [{ name: 'template', value: msg.template }],
        }),
        signal: AbortSignal.timeout(10_000),
      });
    } catch (err) {
      if (attempt < 2) continue;
      throw err;
    }
    const body = await res.json().catch(() => ({}));
    if (res.ok) return body.id;
    if (attempt < 2 && (res.status === 429 || res.status >= 500)) {
      await new Promise((r) => setTimeout(r, 1000));
      continue;
    }
    throw new Error(body.message || `Resend answered ${res.status}`);
  }
}

// null = email is off: nothing leaves the server. Tests swap in a recorder.
let transport = emailEnabled ? resend : null;
export function setTransport(fn) {
  transport = fn;
}

// Returns { status: 'sent' | 'off' | 'suppressed' | 'failed' }. Never throws for delivery problems, so a
// caller can tell the person "we couldn't send the email, try again" without a 500.
export async function sendEmail({ to, template, data = {}, userId = null }) {
  const address = normalizeEmail(to);
  if (!address) throw new Error('sendEmail needs a valid address');
  const message = { to: address, template, ...renderEmail(template, data) };
  const log = (status, providerId = null, error = null) =>
    pool.query(
      `INSERT INTO emails (user_id, to_email, template, status, provider_id, error) VALUES ($1, $2, $3, $4, $5, $6)`,
      [userId, address, template, status, providerId, error],
    );

  const { rowCount } = await pool.query('SELECT 1 FROM email_suppressions WHERE email = $1', [address]);
  if (rowCount) {
    await log('suppressed');
    return { status: 'suppressed' };
  }
  if (!transport) {
    logger.info({ template }, 'email is off (RESEND_API_KEY or EMAIL_FROM not set); not sent');
    await log('off');
    return { status: 'off' };
  }
  try {
    const providerId = await transport(message);
    await log('sent', providerId || null);
    return { status: 'sent' };
  } catch (err) {
    logger.warn({ err, template }, 'email failed');
    await log('failed', null, String(err.message).slice(0, 500));
    return { status: 'failed' };
  }
}

// Resend signs webhooks the Svix way: HMAC-SHA256 over "id.timestamp.body" with the base64 part of the
// whsec_ secret; the header holds space-separated "v1,<base64>" signatures. Rejects anything over 5 min old.
export function verifyWebhook(
  rawBody,
  headers,
  secret = process.env.RESEND_WEBHOOK_SECRET,
  nowS = Date.now() / 1000,
) {
  const id = headers['svix-id'];
  const ts = headers['svix-timestamp'];
  const signatures = headers['svix-signature'];
  if (!secret || !rawBody || !id || !ts || !signatures) return false;
  if (!/^\d+$/.test(ts) || Math.abs(nowS - Number(ts)) > 300) return false;
  const key = Buffer.from(secret.replace(/^whsec_/, ''), 'base64');
  const expected = crypto.createHmac('sha256', key).update(`${id}.${ts}.`).update(rawBody).digest();
  return String(signatures)
    .split(' ')
    .some((part) => {
      const [version, sig] = part.split(',');
      if (version !== 'v1' || !sig) return false;
      const got = Buffer.from(sig, 'base64');
      return got.length === expected.length && crypto.timingSafeEqual(got, expected);
    });
}

async function suppress(addresses, reason, detail) {
  for (const email of addresses) {
    await pool.query(
      `INSERT INTO email_suppressions (email, reason, detail) VALUES ($1, $2, $3) ON CONFLICT (email) DO NOTHING`,
      [email, reason, detail ? String(detail).slice(0, 500) : null],
    );
  }
}

// Bounces and spam complaints from Resend. Safe to receive twice (webhooks retry).
export async function recordEmailEvent(event) {
  const d = event?.data || {};
  const to = (Array.isArray(d.to) ? d.to : [d.to]).map(normalizeEmail).filter(Boolean);
  if (event?.type === 'email.bounced') {
    const detail = d.bounce?.message || d.bounce?.subType || null;
    if (d.email_id)
      await pool.query(`UPDATE emails SET status = 'bounced', error = $2 WHERE provider_id = $1`, [
        d.email_id,
        detail,
      ]);
    // Only permanent bounces (no such mailbox, blocked); a full inbox is worth trying again later.
    if (d.bounce?.type !== 'Transient') await suppress(to, 'bounce', detail);
  } else if (event?.type === 'email.complained') {
    if (d.email_id)
      await pool.query(`UPDATE emails SET status = 'complained' WHERE provider_id = $1`, [d.email_id]);
    await suppress(to, 'complaint', null);
  }
}
