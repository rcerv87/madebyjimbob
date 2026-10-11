// The owned email list (MBJ-107): who asked for news from JimBob. Members opt in at sign-up or in Account settings
// (stored with when and where); contacts from elsewhere (the Shopify newsletter list) are imported with
// `npm run import:newsletter`. Studio → Email exports everyone as a CSV, each row with its own unsubscribe link.
// Never on the list: unconfirmed emails, banned members, addresses that bounced or reported spam, and anyone who
// unsubscribed.
import { pool } from './db.js';
import { baseURL, signValue } from './auth.js';
import { normalizeEmail } from './email.js';
import { parseCsv } from '../../tools/library-uploader/lib.mjs';

const NO_EMAIL = '%@no-email.invalid';

// A link only the address's owner has (it's in their emails): no sign-in needed to unsubscribe.
const tokenFor = (email) => signValue(`unsubscribe:${email}`).slice(0, 32);
export const unsubscribeUrl = (email) =>
  `${baseURL}/api/unsubscribe?e=${encodeURIComponent(email)}&t=${tokenFor(email)}`;
export const validUnsubscribe = (email, token) => Boolean(email) && tokenFor(email) === String(token || '');

export async function marketingState(userId) {
  const { rows } = await pool.query(
    'SELECT marketing_opt_in_at, email, email_verified FROM users WHERE id = $1',
    [userId],
  );
  const u = rows[0];
  return {
    on: Boolean(u?.marketing_opt_in_at),
    since: u?.marketing_opt_in_at || null,
    // News only goes to a confirmed address, so the switch says when that's still missing.
    needsEmail: !u?.email || u.email.endsWith('@no-email.invalid'),
    needsConfirm: Boolean(u?.email && !u.email.endsWith('@no-email.invalid') && !u.email_verified),
  };
}

export async function setMarketing(userId, on, source = 'account') {
  if (on) {
    // Keeps the first yes (and where it was given) if they're already on the list.
    await pool.query(
      `UPDATE users SET marketing_opt_in_at = COALESCE(marketing_opt_in_at, now()),
         marketing_source = COALESCE(marketing_source, $2) WHERE id = $1`,
      [userId, source === 'signup' ? 'signup' : 'account'],
    );
    // Saying yes here also undoes an earlier unsubscribe of the same address from an imported list.
    await pool.query(
      `UPDATE newsletter_contacts SET unsubscribed_at = NULL
       WHERE email = (SELECT lower(email) FROM users WHERE id = $1)`,
      [userId],
    );
  } else {
    await unsubscribe((await pool.query('SELECT email FROM users WHERE id = $1', [userId])).rows[0]?.email);
  }
  return marketingState(userId);
}

// Off everywhere for that address: the member's switch and any imported contact.
export async function unsubscribe(address) {
  const email = normalizeEmail(address);
  if (!email) return false;
  const a = await pool.query(
    `UPDATE users SET marketing_opt_in_at = NULL, marketing_source = NULL
     WHERE lower(email) = $1 AND marketing_opt_in_at IS NOT NULL`,
    [email],
  );
  const b = await pool.query(
    `UPDATE newsletter_contacts SET unsubscribed_at = now() WHERE email = $1 AND unsubscribed_at IS NULL`,
    [email],
  );
  return a.rowCount + b.rowCount > 0;
}

const LIST = `
  SELECT email, name, username, source, opted_in_at FROM (
    SELECT lower(u.email) AS email, u.display_name AS name, u.username,
      COALESCE(u.marketing_source, 'account') AS source, u.marketing_opt_in_at AS opted_in_at
    FROM users u
    WHERE u.marketing_opt_in_at IS NOT NULL AND u.email_verified AND u.email NOT LIKE '${NO_EMAIL}'
      AND u.banned_at IS NULL
    UNION ALL
    SELECT c.email, c.name, NULL, c.source, COALESCE(c.consented_at, c.created_at)
    FROM newsletter_contacts c
    WHERE c.unsubscribed_at IS NULL
      -- Not twice (a member who opted in is listed above), and never a banned member's address.
      AND NOT EXISTS (SELECT 1 FROM users u WHERE lower(u.email) = c.email
                        AND (u.banned_at IS NOT NULL OR (u.marketing_opt_in_at IS NOT NULL AND u.email_verified)))
  ) everyone
  WHERE email NOT IN (SELECT email FROM email_suppressions)
  ORDER BY opted_in_at, email`;

export async function emailList() {
  const { rows } = await pool.query(LIST);
  return rows.map((r) => ({
    email: r.email,
    name: r.name,
    username: r.username,
    source: r.source,
    optedInAt: r.opted_in_at,
    unsubscribeUrl: unsubscribeUrl(r.email),
  }));
}

export async function emailListSummary() {
  const [list, waiting] = await Promise.all([
    emailList(),
    pool.query(
      `SELECT count(*) AS n FROM users WHERE marketing_opt_in_at IS NOT NULL AND NOT email_verified
         AND email NOT LIKE '${NO_EMAIL}' AND banned_at IS NULL`,
    ),
  ]);
  const bySource = {};
  for (const r of list) bySource[r.source] = (bySource[r.source] || 0) + 1;
  return {
    total: list.length,
    members: list.filter((r) => r.username).length,
    imported: list.filter((r) => !r.username).length,
    bySource,
    // Said yes but haven't confirmed their email yet: they join the list when they do.
    waitingToConfirm: Number(waiting.rows[0].n),
  };
}

// Text that a spreadsheet opens as text, never as a formula (a name like "=cmd…" stays a name).
const cell = (value) => {
  let s = value == null ? '' : String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
export async function emailListCsv() {
  const rows = await emailList();
  return [
    ['email', 'name', 'username', 'source', 'opted_in_at', 'unsubscribe_url'].join(','),
    ...rows.map((r) =>
      [
        r.email,
        r.name,
        r.username,
        r.source,
        r.optedInAt ? new Date(r.optedInAt).toISOString() : '',
        r.unsubscribeUrl,
      ]
        .map(cell)
        .join(','),
    ),
  ].join('\r\n');
}

// Shopify's customer export (Customers → Export): keeps only rows that accepted email marketing.
// Returns { added, updated, skipped } with skipped = no email, said no, or already unsubscribed here.
export async function importContacts(csvText, source = 'shopify') {
  const clean = csvText.charCodeAt(0) === 0xfeff ? csvText.slice(1) : csvText;
  const rows = parseCsv(clean);
  const head = (rows[0] || []).map((h) => h.trim().toLowerCase());
  const col = (...names) => head.findIndex((h) => names.includes(h));
  const emailCol = col('email', 'email address');
  if (emailCol < 0) throw new Error('That file has no "Email" column.');
  const acceptsCol = col('accepts email marketing', 'accepts marketing', 'email marketing: status');
  const firstCol = col('first name');
  const lastCol = col('last name');
  const sinceCol = col('email marketing: updated at', 'accepts email marketing updated at', 'created at');
  const result = { added: 0, updated: 0, skipped: 0 };
  for (const r of rows.slice(1)) {
    const email = normalizeEmail(r[emailCol]);
    const said =
      acceptsCol < 0
        ? 'yes'
        : String(r[acceptsCol] || '')
            .trim()
            .toLowerCase();
    if (!email || !['yes', 'true', 'subscribed'].includes(said)) {
      result.skipped += 1;
      continue;
    }
    const name = [r[firstCol], r[lastCol]].filter(Boolean).join(' ').trim().slice(0, 200) || null;
    const since = sinceCol >= 0 ? new Date(r[sinceCol]) : null;
    const { rows: saved } = await pool.query(
      `INSERT INTO newsletter_contacts (email, name, source, consented_at) VALUES ($1, $2, $3, $4)
       ON CONFLICT (email) DO UPDATE SET name = COALESCE(EXCLUDED.name, newsletter_contacts.name)
       RETURNING (xmax = 0) AS inserted, unsubscribed_at`,
      [email, name, String(source).slice(0, 40), since && !Number.isNaN(since.getTime()) ? since : null],
    );
    // Someone who unsubscribed here stays unsubscribed, whatever the other list says.
    if (saved[0].unsubscribed_at) result.skipped += 1;
    else if (saved[0].inserted) result.added += 1;
    else result.updated += 1;
  }
  return result;
}
