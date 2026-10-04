import { describe, test, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import Membership, { MembershipWelcome } from '../pages/Membership.jsx';
import SuperchatForm from '../components/SuperchatForm.jsx';
import Watch from '../pages/Watch.jsx';
import { goTo } from '../membership.js';

function fakeApi(routes) {
  globalThis.fetch = vi.fn(async (url, opts = {}) => {
    const path = String(url)
      .replace(/^\/api/, '')
      .split('?')[0];
    const hit = routes[`${opts.method || 'GET'} ${path}`] || routes[path] || [404, { error: 'Not mocked' }];
    return new Response(JSON.stringify(hit[1]), { status: hit[0] });
  });
  return (method, path) =>
    globalThis.fetch.mock.calls
      .filter(([u, o = {}]) => String(u).split('?')[0] === `/api${path}` && (o.method || 'GET') === method)
      .map(([, o]) => (o.body ? JSON.parse(o.body) : null));
}
const plans = [
  { tier: 'plus', interval: 'month', amount: 500, currency: 'usd' },
  { tier: 'premium', interval: 'month', amount: 1000, currency: 'usd' },
  { tier: 'premium', interval: 'year', amount: 10000, currency: 'usd' },
];
const member = (over = {}) => ({ configured: true, plans, tier: 'free', membership: null, ...over });
afterEach(() => vi.restoreAllMocks());

const renderAt = (path, element, session) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/membership" element={element(session)} />
        <Route path="/membership/welcome" element={element(session)} />
        <Route path="/watch/:id" element={element(session)} />
      </Routes>
    </MemoryRouter>,
  );

describe('membership page (MBJ-105)', () => {
  test('prices from Stripe; signed-out Join asks to sign in', async () => {
    fakeApi({ '/membership': [200, member()] });
    const requireSignIn = vi.fn();
    renderAt('/membership', (s) => <Membership session={s} />, { user: null, requireSignIn });
    expect(await screen.findByText('$5')).toBeTruthy();
    expect(screen.getByText('$10')).toBeTruthy();
    fireEvent.click(screen.getAllByRole('button', { name: 'Sign in to join' })[0]);
    expect(requireSignIn).toHaveBeenCalled();
    // Yearly shows the yearly price where there is one.
    fireEvent.click(screen.getByRole('button', { name: 'Yearly' }));
    expect(screen.getByText('$100')).toBeTruthy();
  });

  test('Join opens Stripe checkout for that plan, coming back to where the viewer was', async () => {
    const sent = fakeApi({
      '/membership': [200, member()],
      'POST /membership/checkout': [200, { url: 'https://checkout.stripe.com/c/x' }],
    });
    const go = vi.spyOn(goTo, 'url').mockImplementation(() => {});
    renderAt('/membership?tier=premium&return=%2Fwatch%2F12', (s) => <Membership session={s} />, {
      user: { username: 'fan', tier: 'free' },
    });
    fireEvent.click(await screen.findByRole('button', { name: 'Join Premium' }));
    await waitFor(() => expect(go).toHaveBeenCalledWith('https://checkout.stripe.com/c/x'));
    expect(sent('POST', '/membership/checkout')).toEqual([
      { tier: 'premium', interval: 'month', returnTo: '/watch/12' },
    ]);
    expect(document.querySelector('.plan-card.picked h2').textContent).toBe('Premium');
  });

  test('a Plus member upgrades to Premium here: today’s price first, then one click', async () => {
    const sent = fakeApi({
      '/membership': [
        200,
        member({ tier: 'plus', membership: { tier: 'plus', status: 'active', live: true } }),
      ],
      '/membership/upgrade': [200, { amountDue: 250, currency: 'usd', tier: 'premium' }],
      'POST /membership/upgrade': [200, { tier: 'premium' }],
    });
    const refreshUser = vi.fn();
    renderAt('/membership?tier=premium', (s) => <Membership session={s} />, {
      user: { username: 'fan', tier: 'plus' },
      refreshUser,
    });
    fireEvent.click(await screen.findByRole('button', { name: 'Upgrade to Premium' }));
    const dialog = await screen.findByRole('dialog', { name: 'Upgrade to Premium' });
    expect(dialog.textContent).toContain('$2.50');
    fireEvent.click(screen.getByRole('button', { name: 'Upgrade for $2.50' }));
    await waitFor(() => expect(refreshUser).toHaveBeenCalled());
    expect(sent('POST', '/membership/upgrade')).toEqual([{ tier: 'premium' }]);
  });

  test('not open yet: says so, and Join is off', async () => {
    fakeApi({ '/membership': [200, member({ configured: false, plans: [] })] });
    renderAt('/membership', (s) => <Membership session={s} />, { user: { username: 'fan', tier: 'free' } });
    expect(await screen.findByText(/Memberships open soon/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Join Plus' }).disabled).toBe(true);
  });

  test('after checkout: waits for the membership to switch on, then offers the way back', async () => {
    const refreshUser = vi.fn();
    fakeApi({});
    renderAt('/membership/welcome?return=%2Fwatch%2F12', (s) => <MembershipWelcome session={s} />, {
      user: { username: 'fan', tier: 'premium' },
      refreshUser,
    });
    expect(await screen.findByText('Welcome to Premium!')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Back to where you were' }).getAttribute('href')).toBe(
      '/watch/12',
    );
  });

  test('a locked video offers Join with its tier, coming back to the video', async () => {
    fakeApi({
      '/videos/4': [
        200,
        { video: { id: 4, title: 'Members stream', minTier: 'premium', locked: true, tags: [] } },
      ],
      '/videos/4/view': [200, { ok: true }],
    });
    renderAt('/watch/4', (s) => <Watch session={s} />, { user: null, requireSignIn: () => {} });
    const join = await screen.findByRole('link', { name: 'Join Premium' });
    expect(join.getAttribute('href')).toBe('/membership?tier=premium&return=%2Fwatch%2F4');
  });
});

describe('super chats (MBJ-109)', () => {
  test('pick or type an amount, add a message, pay on Stripe', async () => {
    const sent = fakeApi({ 'POST /superchats/checkout': [200, { url: 'https://checkout.stripe.com/c/sc' }] });
    const go = vi.spyOn(goTo, 'url').mockImplementation(() => {});
    render(<SuperchatForm session={{ user: { username: 'fan' } }} returnTo="/superchat" />);
    fireEvent.click(screen.getByRole('button', { name: '$20' }));
    fireEvent.change(screen.getByLabelText(/Message/), { target: { value: 'love the show' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send $20 super chat' }));
    await waitFor(() => expect(go).toHaveBeenCalledWith('https://checkout.stripe.com/c/sc'));
    expect(sent('POST', '/superchats/checkout')).toEqual([
      { amountCents: 2000, message: 'love the show', returnTo: '/superchat' },
    ]);
  });

  test('a typed amount under $2 can’t be sent', () => {
    render(<SuperchatForm session={{ user: { username: 'fan' } }} />);
    fireEvent.change(screen.getByLabelText('Other amount ($)'), { target: { value: '1' } });
    expect(screen.getByRole('button', { name: /super chat/ }).disabled).toBe(true);
  });
});
