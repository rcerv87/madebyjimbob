import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import { startServer, stopServer, client, signIn, seedVideo, pool } from './helpers.js';

const realFetch = globalThis.fetch;
const stripe = { calls: [], subscriptions: {}, customers: 0 };
const formOf = (body) => Object.fromEntries(new URLSearchParams(String(body || '')));
function fakeFetch(url, opts = {}) {
  const u = new URL(String(url));
  if (u.hostname !== 'api.stripe.com') return realFetch(url, opts);
  const method = opts.method || 'GET';
  const body = formOf(opts.body);
  stripe.calls.push({ method, path: u.pathname, body });
  const json = (data, status = 200) => Promise.resolve(new Response(JSON.stringify(data), { status }));
  const price = u.pathname.match(/^\/v1\/prices\/(.+)$/);
  if (price) {
    const amounts = { price_plus_m: 500, price_premium_m: 1000, price_premium_y: 10000 };
    return amounts[price[1]]
      ? json({ id: price[1], unit_amount: amounts[price[1]], currency: 'usd', active: true })
      : json({ error: { message: 'No such price' } }, 404);
  }
  if (u.pathname === '/v1/customers') return json({ id: `cus_${(stripe.customers += 1)}` });
  const cus = u.pathname.match(/^\/v1\/customers\/(.+)$/);
  if (cus) return stripe.deleted?.has(cus[1]) ? json({ id: cus[1], deleted: true }) : json({ id: cus[1] });
  if (u.pathname === '/v1/checkout/sessions')
    return json({ id: `cs_${stripe.calls.length}`, url: 'https://checkout.stripe.com/c/test' });
  if (u.pathname === '/v1/billing_portal/sessions') return json({ url: 'https://billing.stripe.com/p/test' });
  if (u.pathname === '/v1/invoices/create_preview') return json({ amount_due: 250, currency: 'usd' });
  const sub = u.pathname.match(/^\/v1\/subscriptions\/(.+)$/);
  if (sub && method === 'POST') {
    const cur = stripe.subscriptions[sub[1]];
    const next = {
      ...cur,
      items: { data: [{ ...cur.items.data[0], price: { id: body['items[0][price]'] } }] },
    };
    stripe.subscriptions[sub[1]] = next;
    return json(next);
  }
  if (sub)
    return stripe.subscriptions[sub[1]]
      ? json(stripe.subscriptions[sub[1]])
      : json({ error: { message: 'No such subscription' } }, 404);
  return json({ error: { message: 'not faked' } }, 404);
}

let call;
let base;
const SECRET = 'whsec_test';
before(async () => {
  Object.assign(process.env, {
    STRIPE_SECRET_KEY: 'sk_test_x',
    STRIPE_WEBHOOK_SECRET: SECRET,
    STRIPE_PRICE_PLUS_MONTHLY: 'price_plus_m',
    STRIPE_PRICE_PREMIUM_MONTHLY: 'price_premium_m',
    STRIPE_PRICE_PREMIUM_YEARLY: 'price_premium_y',
  });
  ({ base } = await startServer());
  call = client(base);
  globalThis.fetch = fakeFetch;
});
after(async () => {
  globalThis.fetch = realFetch;
  for (const k of [
    'STRIPE_SECRET_KEY',
    'STRIPE_WEBHOOK_SECRET',
    'STRIPE_PRICE_PLUS_MONTHLY',
    'STRIPE_PRICE_PREMIUM_MONTHLY',
    'STRIPE_PRICE_PREMIUM_YEARLY',
  ])
    delete process.env[k];
  await stopServer();
});

// Sends a Stripe event the way Stripe does: JSON body, signed header.
async function webhook(event, secret = SECRET) {
  const raw = JSON.stringify(event);
  const t = Math.floor(Date.now() / 1000);
  const sig = crypto.createHmac('sha256', secret).update(`${t}.${raw}`).digest('hex');
  const res = await realFetch(`${new URL(base).origin}/api/webhooks/stripe`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Stripe-Signature': `t=${t},v1=${sig}` },
    body: raw,
  });
  return { status: res.status, data: await res.json() };
}
const subscription = (id, userId, over = {}) => ({
  id,
  object: 'subscription',
  customer: 'cus_x',
  status: 'active',
  cancel_at_period_end: false,
  metadata: { user_id: String(userId) },
  items: {
    data: [
      { price: { id: 'price_premium_m' }, current_period_end: Math.floor(Date.now() / 1000) + 30 * 86400 },
    ],
  },
  ...over,
});
const userId = async (name) =>
  (await pool.query('SELECT id FROM users WHERE username = $1', [name])).rows[0].id;

describe('memberships (MBJ-104)', () => {
  test('the plans and prices come from Stripe', async () => {
    // A wrong id (e.g. a test-mode price with the live key) isn't remembered: fixing the setting works at once.
    process.env.STRIPE_PRICE_PLUS_MONTHLY = 'price_from_test_mode';
    assert.deepEqual(
      (await call('/membership')).data.plans.map((p) => p.tier),
      ['premium', 'premium'],
    );
    process.env.STRIPE_PRICE_PLUS_MONTHLY = ' price_plus_m\n'; // pasted with a space and a line break
    const r = await call('/membership');
    assert.equal(r.data.configured, true);
    assert.deepEqual(
      r.data.plans.map((p) => [p.tier, p.interval, p.amount]),
      [
        ['plus', 'month', 500],
        ['premium', 'month', 1000],
        ['premium', 'year', 10000],
      ],
    );
  });

  test('checkout: sign in first, a real plan, one Stripe customer per member, back to where they were', async () => {
    assert.equal(
      (await call('/membership/checkout', { method: 'POST', body: { tier: 'plus', interval: 'month' } }))
        .status,
      401,
    );
    const token = await signIn(call, 'bill_fan');
    assert.equal(
      (
        await call('/membership/checkout', {
          method: 'POST',
          token,
          body: { tier: 'gold', interval: 'month' },
        })
      ).status,
      400,
    );
    stripe.calls = [];
    const r = await call('/membership/checkout', {
      method: 'POST',
      token,
      body: { tier: 'premium', interval: 'year', returnTo: '/watch/12' },
    });
    assert.equal(r.status, 200);
    assert.equal(r.data.url, 'https://checkout.stripe.com/c/test');
    const session = stripe.calls.find((c) => c.path === '/v1/checkout/sessions').body;
    assert.equal(session.mode, 'subscription');
    assert.equal(session['line_items[0][price]'], 'price_premium_y');
    assert.deepEqual(
      [session['payment_method_types[0]'], session['payment_method_types[1]']],
      ['card', undefined],
    );
    assert.equal(session.client_reference_id, String(await userId('bill_fan')));
    assert.match(session.success_url, /\/membership\/welcome\?return=%2Fwatch%2F12$/);
    // A second try reuses the same Stripe customer.
    await call('/membership/checkout', { method: 'POST', token, body: { tier: 'plus', interval: 'month' } });
    assert.equal(stripe.calls.filter((c) => c.path === '/v1/customers').length, 1);
    // A full address as returnTo is ignored (only paths on this site).
    await call('/membership/checkout', {
      method: 'POST',
      token,
      body: { tier: 'plus', interval: 'month', returnTo: '//evil.example' },
    });
    assert.match(stripe.calls.at(-1).body.success_url, /return=%2F$/);
  });

  test('Stripe events set the tier: paid → Premium; renewals keep it; cancelled → back; each event once', async () => {
    const token = await signIn(call, 'bill_member');
    const id = await userId('bill_member');
    assert.equal((await webhook({ id: 'evt_bad', type: 'x', data: { object: {} } }, 'wrong')).status, 400);

    stripe.subscriptions.sub_1 = subscription('sub_1', id);
    const done = await webhook({
      id: 'evt_1',
      type: 'checkout.session.completed',
      data: { object: { mode: 'subscription', subscription: 'sub_1', client_reference_id: String(id) } },
    });
    assert.equal(done.data.result, 'handled');
    assert.equal((await call('/me', { token })).data.user.tier, 'premium');
    const m = (await call('/membership', { token })).data.membership;
    assert.deepEqual([m.tier, m.status, m.interval, m.live], ['premium', 'active', 'month', true]);
    assert.ok(new Date(m.renewsAt) > new Date());
    // Already a member: no second subscription.
    assert.equal(
      (
        await call('/membership/checkout', {
          method: 'POST',
          token,
          body: { tier: 'plus', interval: 'month' },
        })
      ).status,
      409,
    );

    assert.equal(
      (await webhook({ id: 'evt_1', type: 'checkout.session.completed', data: { object: {} } })).data.result,
      'duplicate',
    );
    await webhook({
      id: 'evt_2',
      type: 'customer.subscription.updated',
      data: { object: subscription('sub_1', id, { status: 'past_due' }) },
    });
    assert.equal((await call('/me', { token })).data.user.tier, 'premium', 'card retrying: still a member');
    await webhook({
      id: 'evt_3',
      type: 'customer.subscription.deleted',
      data: { object: subscription('sub_1', id, { status: 'canceled' }) },
    });
    assert.equal((await call('/me', { token })).data.user.tier, 'free');
  });

  test('a tier given by hand stays when a subscription ends', async () => {
    const token = await signIn(call, 'bill_comped');
    const id = await userId('bill_comped');
    await pool.query(`UPDATE users SET manual_tier = 'plus', tier = 'plus' WHERE id = $1`, [id]);
    await webhook({
      id: 'evt_4',
      type: 'customer.subscription.updated',
      data: { object: subscription('sub_2', id) },
    });
    assert.equal((await call('/me', { token })).data.user.tier, 'premium');
    await webhook({
      id: 'evt_5',
      type: 'customer.subscription.deleted',
      data: { object: subscription('sub_2', id, { status: 'canceled' }) },
    });
    assert.equal((await call('/me', { token })).data.user.tier, 'plus');
  });

  test('Plus → Premium in place: today’s prorated price first, then the switch, same billing interval', async () => {
    const token = await signIn(call, 'bill_upgrader');
    const id = await userId('bill_upgrader');
    const plus = subscription('sub_up', id);
    plus.items.data[0].id = 'si_up';
    plus.items.data[0].price = { id: 'price_plus_m' };
    stripe.subscriptions.sub_up = plus;
    await webhook({ id: 'evt_up1', type: 'customer.subscription.created', data: { object: plus } });
    assert.equal((await call('/me', { token })).data.user.tier, 'plus');
    assert.equal((await call('/membership/upgrade?tier=plus', { token })).status, 400, 'not an upgrade');

    const preview = await call('/membership/upgrade?tier=premium', { token });
    assert.deepEqual(preview.data, { amountDue: 250, currency: 'usd', tier: 'premium' });
    const p = stripe.calls.find((c) => c.path === '/v1/invoices/create_preview').body;
    assert.equal(p['subscription_details[items][0][price]'], 'price_premium_m');

    const done = await call('/membership/upgrade', { method: 'POST', token, body: { tier: 'premium' } });
    assert.equal(done.status, 200);
    const update = stripe.calls.findLast(
      (c) => c.path === '/v1/subscriptions/sub_up' && c.method === 'POST',
    ).body;
    assert.deepEqual(
      [update['items[0][id]'], update['items[0][price]'], update.proration_behavior],
      ['si_up', 'price_premium_m', 'always_invoice'],
    );
    assert.equal(
      (await call('/me', { token })).data.user.tier,
      'premium',
      'right away, not after the webhook',
    );
  });

  test('a subscription Stripe doesn’t know (made in test mode) ends instead of breaking the upgrade', async () => {
    const token = await signIn(call, 'bill_testmode');
    const id = await userId('bill_testmode');
    await webhook({
      id: 'evt_tm1',
      type: 'customer.subscription.created',
      data: {
        object: subscription('sub_testmode', id, {
          items: { data: [{ id: 'si_tm', price: { id: 'price_plus_m' } }] },
        }),
      },
    });
    assert.equal((await call('/me', { token })).data.user.tier, 'plus');
    const r = await call('/membership/upgrade?tier=premium', { token });
    assert.equal(r.status, 409);
    assert.match(r.data.error, /Join a plan/);
    assert.equal((await call('/me', { token })).data.user.tier, 'free');
    assert.equal((await call('/membership', { token })).data.membership.live, false);
  });

  test('a customer deleted in Stripe is replaced by a new one', async () => {
    const token = await signIn(call, 'bill_deleted');
    await call('/membership/portal', { method: 'POST', token });
    const old = (await pool.query(`SELECT stripe_customer_id FROM users WHERE username = 'bill_deleted'`))
      .rows[0].stripe_customer_id;
    stripe.deleted = new Set([old]);
    await call('/membership/portal', { method: 'POST', token });
    const now = (await pool.query(`SELECT stripe_customer_id FROM users WHERE username = 'bill_deleted'`))
      .rows[0].stripe_customer_id;
    assert.notEqual(now, old);
    stripe.deleted = null;
  });

  test('Manage billing opens Stripe’s page', async () => {
    const token = await signIn(call, 'bill_portal');
    const r = await call('/membership/portal', { method: 'POST', token });
    assert.equal(r.data.url, 'https://billing.stripe.com/p/test');
    assert.match(stripe.calls.at(-1).body.return_url, /\/account#membership$/);
  });
});

describe('super chats (MBJ-109)', () => {
  test('any time: not live on the site, it still goes to checkout, and Studio shows it once paid', async () => {
    const token = await signIn(call, 'sc_anytime');
    stripe.calls = [];
    const r = await call('/superchats/checkout', {
      method: 'POST',
      token,
      body: { amountCents: 1000, message: 'from YouTube with love', returnTo: '/superchat' },
    });
    assert.equal(r.status, 200);
    const session = stripe.calls.find((c) => c.path === '/v1/checkout/sessions').body;
    assert.equal(session.mode, 'payment');
    assert.deepEqual(
      [session['payment_method_types[0]'], session['payment_method_types[1]']],
      ['card', undefined],
    );
    assert.equal(session['line_items[0][price_data][unit_amount]'], '1000');
    assert.match(session.success_url, /\/superchat\?superchat=sent$/);
    assert.equal(
      (await call('/superchats/checkout', { method: 'POST', token, body: { amountCents: 100 } })).status,
      400,
    );

    const sc = (
      await pool.query(`SELECT id, video_id FROM superchats WHERE message = 'from YouTube with love'`)
    ).rows[0];
    assert.equal(sc.video_id, null);
    await webhook({
      id: 'evt_any',
      type: 'checkout.session.completed',
      data: {
        object: { mode: 'payment', payment_status: 'paid', metadata: { superchat_id: String(sc.id) } },
      },
    });
    const admin = await signIn(call, 'test_admin');
    const list = (await call('/studio/superchats', { token: admin })).data.superchats;
    assert.deepEqual(
      [list[0].author, list[0].amountCents, list[0].message, list[0].videoId],
      ['sc_anytime', 1000, 'from YouTube with love', null],
    );
    assert.equal((await call('/studio/superchats', { token })).status, 403, 'Studio only');
  });

  test('once paid, it joins the stream’s chat as a paid message with the amount; once only', async () => {
    await signIn(call, 'sc_fan');
    const id = await userId('sc_fan');
    const videoId = await seedVideo();
    const { rows } = await pool.query(
      `INSERT INTO superchats (user_id, video_id, amount_cents, message) VALUES ($1, $2, 500, 'great show @jimbob') RETURNING id`,
      [id, videoId],
    );
    const paid = { mode: 'payment', payment_status: 'paid', metadata: { superchat_id: String(rows[0].id) } };
    await webhook({ id: 'evt_sc1', type: 'checkout.session.completed', data: { object: paid } });
    await webhook({ id: 'evt_sc2', type: 'checkout.session.completed', data: { object: paid } });
    const chat = (await call(`/videos/${videoId}/chat?from=0&to=600000`)).data.messages;
    assert.equal(chat.length, 1);
    assert.deepEqual(
      [chat[0].kind, chat[0].amount, chat[0].body, chat[0].author],
      ['paid', '$5.00', 'great show @jimbob', 'sc_fan'],
    );
    const sc = (
      await pool.query('SELECT status, chat_message_id FROM superchats WHERE id = $1', [rows[0].id])
    ).rows[0];
    assert.equal(sc.status, 'paid');
    assert.equal(String(sc.chat_message_id), chat[0].id);
  });
});
