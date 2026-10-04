// Memberships and super chats through Stripe (MBJ-104, MBJ-109, ADR-013). Talks to Stripe's REST API with fetch, so
// there's no SDK to keep up to date. Stripe holds the prices (set in its dashboard), the cards and the receipts; the
// site keeps who has which subscription, and sets users.tier from it.
//
// Settings: STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, and the price ids STRIPE_PRICE_PLUS_MONTHLY,
// STRIPE_PRICE_PLUS_YEARLY, STRIPE_PRICE_PREMIUM_MONTHLY, STRIPE_PRICE_PREMIUM_YEARLY (any can be left out).
import crypto from 'crypto';
import { pool } from './db.js';
import { logger } from './logger.js';

const API = 'https://api.stripe.com/v1';
const TIERS = ['free', 'plus', 'premium'];
const rank = (t) => TIERS.indexOf(t);
const higher = (a, b) => (rank(a) >= rank(b) ? a : b);
// A subscription in these states still gives its tier (past_due: Stripe is retrying the card).
const LIVE_STATUSES = ['active', 'trialing', 'past_due'];

export const SUPERCHAT_MIN_CENTS = 200;
export const SUPERCHAT_MAX_CENTS = 50_000;

export const billingConfigured = () => Boolean(process.env.STRIPE_SECRET_KEY);

// Price id → { tier, interval } from the settings.
function priceMap() {
  const map = new Map();
  for (const tier of ['plus', 'premium'])
    for (const interval of ['monthly', 'yearly']) {
      const id = process.env[`STRIPE_PRICE_${tier.toUpperCase()}_${interval.toUpperCase()}`];
      if (id) map.set(id, { tier, interval: interval === 'monthly' ? 'month' : 'year' });
    }
  return map;
}

// Stripe's form encoding, nested keys included: { line_items: [{ price: 'p' }] } → line_items[0][price]=p.
function form(obj, prefix = '', out = new URLSearchParams()) {
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue;
    const key = prefix ? `${prefix}[${k}]` : k;
    if (typeof v === 'object') form(v, key, out);
    else out.append(key, String(v));
  }
  return out;
}

async function stripe(method, path, params) {
  const res = await fetch(`${API}${path}${method === 'GET' && params ? `?${form(params)}` : ''}`, {
    method,
    headers: {
      Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: method === 'GET' ? undefined : form(params || {}),
    signal: AbortSignal.timeout(15000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error?.message || `Stripe answered ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return data;
}

// ---------- plans ----------

let planCache = { at: 0, plans: null };

// [{ tier, interval, amount (cents), currency }] for the configured prices, read from Stripe (cached 10 minutes).
export async function plans() {
  if (!billingConfigured()) return [];
  if (planCache.plans && Date.now() - planCache.at < 600_000) return planCache.plans;
  const out = [];
  for (const [id, p] of priceMap()) {
    try {
      const price = await stripe('GET', `/prices/${encodeURIComponent(id)}`);
      if (price.active !== false) out.push({ ...p, amount: price.unit_amount, currency: price.currency });
    } catch (err) {
      logger.warn({ err, price: id }, 'could not read a Stripe price');
    }
  }
  planCache = { at: Date.now(), plans: out };
  return out;
}

const priceFor = (tier, interval) =>
  [...priceMap()].find(([, p]) => p.tier === tier && p.interval === interval)?.[0] || null;

// ---------- customers and checkout ----------

async function customerFor(user) {
  const { rows } = await pool.query('SELECT stripe_customer_id, email FROM users WHERE id = $1', [user.id]);
  // A customer deleted in Stripe's dashboard gets replaced by a new one.
  if (rows[0]?.stripe_customer_id) {
    const existing = await stripe('GET', `/customers/${rows[0].stripe_customer_id}`).catch((err) => {
      if (err.status === 404) return { deleted: true };
      throw err;
    });
    if (!existing.deleted) return rows[0].stripe_customer_id;
  }
  const customer = await stripe('POST', '/customers', {
    email: rows[0]?.email || undefined,
    name: user.username,
    metadata: { user_id: user.id },
  });
  await pool.query('UPDATE users SET stripe_customer_id = $2 WHERE id = $1', [user.id, customer.id]);
  return customer.id;
}

// Returns Stripe's checkout page address. returnTo: where to land afterwards (a path on this site).
// Throws { status: 400 | 409 } with a message for the viewer.
export async function membershipCheckout(user, { tier, interval, returnTo, site }) {
  const price = priceFor(tier, interval === 'year' ? 'year' : 'month');
  if (!price) throw Object.assign(new Error('That plan isn’t available.'), { status: 400 });
  const { rows } = await pool.query(
    `SELECT 1 FROM subscriptions WHERE user_id = $1 AND status = ANY($2::text[])`,
    [user.id, LIVE_STATUSES],
  );
  if (rows.length)
    throw Object.assign(new Error('You already have a membership. Change it from Manage billing.'), {
      status: 409,
    });
  const back = safePath(returnTo);
  const session = await stripe('POST', '/checkout/sessions', {
    mode: 'subscription',
    customer: await customerFor(user),
    client_reference_id: user.id,
    line_items: [{ price, quantity: 1 }],
    allow_promotion_codes: true,
    subscription_data: { metadata: { user_id: user.id } },
    success_url: `${site}/membership/welcome?return=${encodeURIComponent(back)}`,
    cancel_url: `${site}/membership?return=${encodeURIComponent(back)}`,
  });
  return session.url;
}

// Stripe's page to change card, switch plan, cancel, and see receipts.
export async function billingPortal(user, { site }) {
  const customer = await customerFor(user);
  const session = await stripe('POST', '/billing_portal/sessions', {
    customer,
    return_url: `${site}/account#membership`,
  });
  return session.url;
}

// ---------- upgrading in place (Plus → Premium) ----------

// The member's live subscription, its item, and the price to move to (same billing interval when offered).
async function upgradeTarget(user, tier) {
  const { rows } = await pool.query(
    `SELECT id, tier, billing_interval FROM subscriptions WHERE user_id = $1 AND status = ANY($2::text[])
      ORDER BY updated_at DESC LIMIT 1`,
    [user.id, LIVE_STATUSES],
  );
  const current = rows[0];
  if (!current) throw Object.assign(new Error('Join a plan first.'), { status: 400 });
  if (rank(tier) <= rank(current.tier))
    throw Object.assign(new Error('That isn’t an upgrade from your plan.'), { status: 400 });
  const price = priceFor(tier, current.billing_interval) || priceFor(tier, 'month');
  if (!price) throw Object.assign(new Error('That plan isn’t available.'), { status: 400 });
  const sub = await stripe('GET', `/subscriptions/${current.id}`);
  return { sub, item: sub.items.data[0], price };
}

// What switching now costs today (the prorated difference), before the member confirms.
export async function upgradePreview(user, tier) {
  const { sub, item, price } = await upgradeTarget(user, tier);
  const invoice = await stripe('POST', '/invoices/create_preview', {
    customer: sub.customer,
    subscription: sub.id,
    subscription_details: { items: [{ id: item.id, price }], proration_behavior: 'always_invoice' },
  });
  return { amountDue: invoice.amount_due, currency: invoice.currency, tier };
}

// Switch now, charging the difference to the card on file; the tier changes right away.
export async function upgradeSubscription(user, tier) {
  const { sub, item, price } = await upgradeTarget(user, tier);
  let updated;
  try {
    updated = await stripe('POST', `/subscriptions/${sub.id}`, {
      items: [{ id: item.id, price }],
      proration_behavior: 'always_invoice',
      payment_behavior: 'error_if_incomplete',
    });
  } catch (err) {
    if (err.status === 402 || err.status === 400)
      throw Object.assign(new Error(`The card was declined: ${err.message}`), { status: 400 });
    throw err;
  }
  await saveSubscription(updated, user.id);
  return { tier };
}

// Super chat checkout: the message waits until the payment succeeds, then goes into the live chat (videoId: the
// stream live on the site, or null when he isn't: it still goes through and shows in Studio).
export async function superchatCheckout(user, { videoId, amountCents, message, returnTo, site }) {
  const cents = Math.round(Number(amountCents));
  if (!Number.isFinite(cents) || cents < SUPERCHAT_MIN_CENTS || cents > SUPERCHAT_MAX_CENTS)
    throw Object.assign(new Error('Pick an amount from $2 to $500.'), { status: 400 });
  const { rows } = await pool.query(
    `INSERT INTO superchats (user_id, video_id, amount_cents, message) VALUES ($1, $2, $3, $4) RETURNING id`,
    [user.id, videoId || null, cents, message],
  );
  const id = rows[0].id;
  const back = safePath(returnTo || '/live');
  const session = await stripe('POST', '/checkout/sessions', {
    mode: 'payment',
    customer: await customerFor(user),
    client_reference_id: user.id,
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: 'usd',
          unit_amount: cents,
          product_data: {
            name: 'Super chat for JimBob',
            description: message ? message.slice(0, 200) : undefined,
          },
        },
      },
    ],
    metadata: { superchat_id: id },
    payment_intent_data: { metadata: { superchat_id: id } },
    success_url: `${site}${back}${back.includes('?') ? '&' : '?'}superchat=sent`,
    cancel_url: `${site}${back}`,
  });
  await pool.query('UPDATE superchats SET checkout_id = $2 WHERE id = $1', [id, session.id]);
  return session.url;
}

// Only paths on this site (no "//evil.com" or full addresses).
function safePath(p) {
  const s = String(p || '/');
  return s.startsWith('/') && !s.startsWith('//') ? s : '/';
}

// ---------- webhooks ----------

// Stripe-Signature: t=<time>,v1=<hmac>[,v1=…]; the HMAC is over "<time>.<raw body>". Five minutes of leeway.
export function verifyStripeSignature(raw, header, secret = process.env.STRIPE_WEBHOOK_SECRET) {
  if (!secret || !raw || !header) return false;
  const parts = Object.fromEntries(
    String(header)
      .split(',')
      .map((kv) => kv.split('='))
      .filter(([k]) => k === 't'),
  );
  const sigs = String(header)
    .split(',')
    .filter((kv) => kv.startsWith('v1='))
    .map((kv) => kv.slice(3));
  const t = Number(parts.t);
  if (!t || Math.abs(Date.now() / 1000 - t) > 300) return false;
  const expected = crypto.createHmac('sha256', secret).update(`${t}.${raw}`).digest('hex');
  return sigs.some(
    (s) => s.length === expected.length && crypto.timingSafeEqual(Buffer.from(s), Buffer.from(expected)),
  );
}

// One Stripe event, applied once. onPaidChat(superchat) posts a paid super chat to its video's live chat.
export async function handleStripeEvent(event, { onPaidChat } = {}) {
  const fresh = await pool.query(
    'INSERT INTO payment_events (id, type) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING RETURNING id',
    [event.id, event.type],
  );
  if (!fresh.rows.length) return 'duplicate';
  const obj = event.data?.object || {};
  switch (event.type) {
    case 'checkout.session.completed':
      if (obj.mode === 'subscription' && obj.subscription)
        await saveSubscription(
          await stripe('GET', `/subscriptions/${obj.subscription}`),
          obj.client_reference_id,
        );
      if (obj.mode === 'payment' && obj.metadata?.superchat_id && obj.payment_status === 'paid')
        await superchatPaid(obj.metadata.superchat_id, onPaidChat);
      break;
    case 'customer.subscription.created':
    case 'customer.subscription.updated':
    case 'customer.subscription.deleted':
      await saveSubscription(obj);
      break;
    case 'checkout.session.expired':
      if (obj.metadata?.superchat_id)
        await pool.query(`UPDATE superchats SET status = 'expired' WHERE id = $1 AND status = 'pending'`, [
          obj.metadata.superchat_id,
        ]);
      break;
    case 'charge.refunded':
      if (obj.metadata?.superchat_id)
        await pool.query(`UPDATE superchats SET status = 'refunded' WHERE id = $1`, [
          obj.metadata.superchat_id,
        ]);
      break;
    default:
      return 'ignored';
  }
  return 'handled';
}

async function userForSubscription(sub, hint) {
  const direct = sub.metadata?.user_id || hint;
  if (direct) return direct;
  const { rows } = await pool.query('SELECT id FROM users WHERE stripe_customer_id = $1', [sub.customer]);
  return rows[0]?.id || null;
}

async function saveSubscription(sub, hint) {
  const userId = await userForSubscription(sub, hint);
  const item = sub.items?.data?.[0];
  const plan = priceMap().get(item?.price?.id);
  if (!userId || !plan) {
    logger.warn(
      { subscription: sub.id, price: item?.price?.id },
      'subscription for an unknown member or price',
    );
    return;
  }
  // Newer Stripe versions keep the period on the item.
  const periodEnd = sub.current_period_end ?? item?.current_period_end;
  await pool.query(
    `INSERT INTO subscriptions (id, user_id, status, tier, price_id, billing_interval, current_period_end, cancel_at_period_end)
     VALUES ($1, $2, $3, $4, $5, $6, to_timestamp($7), $8)
     ON CONFLICT (id) DO UPDATE SET status = $3, tier = $4, price_id = $5, billing_interval = $6,
       current_period_end = to_timestamp($7), cancel_at_period_end = $8, updated_at = now()`,
    [
      sub.id,
      userId,
      sub.status,
      plan.tier,
      item.price.id,
      plan.interval,
      periodEnd || null,
      Boolean(sub.cancel_at_period_end),
    ],
  );
  await recomputeTier(userId);
  logger.info({ userId, subscription: sub.id, status: sub.status, tier: plan.tier }, 'membership updated');
}

// users.tier = the higher of the tier given by hand and any live subscription.
export async function recomputeTier(userId) {
  const { rows } = await pool.query(
    `SELECT u.manual_tier, coalesce(array_agg(s.tier) FILTER (WHERE s.status = ANY($2::text[])), '{}') AS tiers
       FROM users u LEFT JOIN subscriptions s ON s.user_id = u.id WHERE u.id = $1 GROUP BY u.id`,
    [userId, LIVE_STATUSES],
  );
  if (!rows[0]) return null;
  const tier = rows[0].tiers.reduce(higher, rows[0].manual_tier);
  await pool.query('UPDATE users SET tier = $2 WHERE id = $1', [userId, tier]);
  return tier;
}

async function superchatPaid(id, onPaidChat) {
  const { rows } = await pool.query(
    `UPDATE superchats SET status = 'paid', paid_at = now() WHERE id = $1 AND status = 'pending' RETURNING *`,
    [id],
  );
  if (rows[0] && onPaidChat) await onPaidChat(rows[0]);
}

// ---------- what Account settings shows ----------

export async function membershipOf(userId) {
  const { rows } = await pool.query(
    `SELECT tier, status, billing_interval, current_period_end, cancel_at_period_end FROM subscriptions
      WHERE user_id = $1 ORDER BY (status = ANY($2::text[])) DESC, updated_at DESC LIMIT 1`,
    [userId, LIVE_STATUSES],
  );
  const s = rows[0];
  return s
    ? {
        tier: s.tier,
        status: s.status,
        interval: s.billing_interval,
        renewsAt: s.current_period_end,
        cancelAtPeriodEnd: s.cancel_at_period_end,
        live: LIVE_STATUSES.includes(s.status),
      }
    : null;
}
