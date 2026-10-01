import { describe, test, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import Account, { describeDevice } from '../pages/Account.jsx';

// fetch stand-in: routes map "METHOD /path" (or "/path") to [status, body]; returns a body finder.
function fakeApi(routes) {
  globalThis.fetch = vi.fn(async (url, opts = {}) => {
    const path = String(url).replace(/^\/api/, '');
    const hit = routes[`${opts.method || 'GET'} ${path}`] || routes[path] || [404, { error: 'Not mocked' }];
    return new Response(JSON.stringify(hit[1]), { status: hit[0] });
  });
  return (method, path) =>
    globalThis.fetch.mock.calls
      .filter(([url, opts = {}]) => String(url) === `/api${path}` && (opts.method || 'GET') === method)
      .map(([, opts]) => (opts.body ? JSON.parse(opts.body) : null));
}

const user = {
  id: 1,
  username: 'Fan',
  displayName: 'Fan',
  email: 'fan@example.com',
  emailVerified: true,
  tier: 'free',
};
const prefs = { mention: { site: true, push: true }, reply: { site: true, push: true } };
const routes = {
  '/account/notifications': [200, { prefs }],
  '/account/security': [
    200,
    {
      events: [
        {
          id: 2,
          type: 'password_changed',
          userAgent: 'Mozilla/5.0 (Windows NT 10.0) Chrome/140',
          createdAt: new Date(),
        },
        { id: 1, type: 'account_created', createdAt: new Date() },
      ],
    },
  ],
  '/auth/list-sessions': [
    200,
    [
      { id: 1, token: 'mine', userAgent: 'Mozilla/5.0 (iPhone) Safari/605', createdAt: new Date() },
      {
        id: 2,
        token: 'other',
        userAgent: 'Mozilla/5.0 (Windows NT 10.0) Firefox/130',
        createdAt: new Date(),
      },
    ],
  ],
  '/auth/get-session': [200, { session: { token: 'mine' } }],
  '/push/key': [200, { publicKey: null }],
};

const renderAccount = (u = user, path = '/account') =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <Account session={{ user: u, requireSignIn: () => {} }} onUserChanged={() => {}} />
    </MemoryRouter>,
  );

describe('account settings page', () => {
  test('asks signed-out visitors to sign in', () => {
    fakeApi(routes);
    renderAccount(null);
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeTruthy();
  });

  test('shows the sections, devices with this one first, and recent activity', async () => {
    fakeApi(routes);
    renderAccount();
    for (const h of ['Profile', 'Sign-in and security', 'Notifications', 'Membership', 'Privacy and data']) {
      expect(screen.getByRole('heading', { name: h })).toBeTruthy();
    }
    expect(screen.getByText('Confirmed')).toBeTruthy();
    const devices = await screen.findByText('Safari on iPhone');
    expect(within(devices.closest('li')).getByText('This device')).toBeTruthy();
    expect(screen.getByText('Firefox on Windows')).toBeTruthy();
    expect(await screen.findByText('Password changed')).toBeTruthy();
  });

  test('signs out another device, or all of them', async () => {
    const sent = fakeApi({
      ...routes,
      'POST /auth/revoke-session': [200, { status: true }],
      'POST /auth/revoke-other-sessions': [200, { status: true }],
    });
    renderAccount();
    const other = await screen.findByText('Firefox on Windows');
    fireEvent.click(within(other.closest('li')).getByRole('button', { name: 'Sign out' }));
    await waitFor(() => expect(sent('POST', '/auth/revoke-session')).toEqual([{ token: 'other' }]));
    fireEvent.click(screen.getByRole('button', { name: 'Sign out everywhere else' }));
    await waitFor(() => expect(sent('POST', '/auth/revoke-other-sessions')).toHaveLength(1));
  });

  test('notification checkboxes save one change at a time', async () => {
    const sent = fakeApi({
      ...routes,
      'PUT /account/notifications': [200, { prefs: { ...prefs, reply: { site: true, push: false } } }],
    });
    renderAccount();
    const box = await screen.findByLabelText('Someone replies to you: push');
    fireEvent.click(box);
    await waitFor(() =>
      expect(sent('PUT', '/account/notifications')).toEqual([{ prefs: { reply: { push: false } } }]),
    );
    expect(box.checked).toBe(false);
  });

  test('changing the password checks the two new ones match, then signs out other devices', async () => {
    const sent = fakeApi({ ...routes, 'POST /auth/change-password': [200, { token: 't' }] });
    renderAccount();
    const section = screen.getByRole('heading', { name: 'Password' }).closest('.setting');
    fireEvent.click(within(section).getByRole('button', { name: 'Change' }));
    fireEvent.change(screen.getByLabelText('Current password'), { target: { value: 'old-password-1' } });
    fireEvent.change(screen.getByLabelText('New password'), { target: { value: 'new-password-12' } });
    fireEvent.change(screen.getByLabelText('Type the new one again'), { target: { value: 'different-123' } });
    fireEvent.click(screen.getByRole('button', { name: 'Change password' }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/don’t match/);
    fireEvent.change(screen.getByLabelText('Type the new one again'), {
      target: { value: 'new-password-12' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Change password' }));
    expect(await screen.findByText(/other devices were signed out/)).toBeTruthy();
    expect(sent('POST', '/auth/change-password')).toEqual([
      { currentPassword: 'old-password-1', newPassword: 'new-password-12', revokeOtherSessions: true },
    ]);
  });

  test('changing the email needs the password and says a link was sent', async () => {
    const sent = fakeApi({
      ...routes,
      'POST /account/email': [200, { ok: true, sentTo: 'new@example.com' }],
    });
    renderAccount();
    const section = screen.getByRole('heading', { name: 'Email' }).closest('.setting');
    fireEvent.click(within(section).getByRole('button', { name: 'Change' }));
    fireEvent.change(screen.getByLabelText('New email'), { target: { value: 'new@example.com' } });
    fireEvent.change(screen.getByLabelText('Your password'), { target: { value: 'password1234' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send confirmation link' }));
    expect(await screen.findByText(/We sent a link to/)).toBeTruthy();
    expect(sent('POST', '/account/email')).toEqual([
      { newEmail: 'new@example.com', password: 'password1234' },
    ]);
  });

  test('explains the result of the confirmation link', () => {
    fakeApi(routes);
    renderAccount(user, '/account?email=changed');
    expect(screen.getByText(/Your email is changed/)).toBeTruthy();
  });

  test('names devices from their browser', () => {
    expect(describeDevice('Mozilla/5.0 (Windows NT 10.0) AppleWebKit Chrome/140 Safari/537 Edg/140')).toBe(
      'Edge on Windows',
    );
    expect(describeDevice('Mozilla/5.0 (Linux; Android 14) Chrome/140 Mobile Safari/537')).toBe(
      'Chrome on Android',
    );
    expect(describeDevice(null)).toBe('Unknown device');
  });
});

describe('privacy and data', () => {
  test('download is a plain link to the export', () => {
    fakeApi(routes);
    renderAccount();
    expect(screen.getByRole('link', { name: 'Download' }).getAttribute('href')).toBe('/api/account/export');
  });

  test('deleting asks what to do with messages and for the password, then signs out', async () => {
    const sent = fakeApi({ ...routes, 'POST /account/delete': [200, { ok: true, eraseOn: new Date() }] });
    const onUserChanged = vi.fn();
    render(
      <MemoryRouter initialEntries={['/account']}>
        <Account session={{ user, requireSignIn: () => {} }} onUserChanged={onUserChanged} />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Delete…' }));
    fireEvent.click(screen.getByLabelText(/Remove them too/));
    fireEvent.change(screen.getByLabelText('Your password'), { target: { value: 'password1234' } });
    fireEvent.click(screen.getByRole('button', { name: 'Delete my account' }));
    await waitFor(() => expect(onUserChanged).toHaveBeenCalledWith(null));
    expect(sent('POST', '/account/delete')).toEqual([{ password: 'password1234', deleteContent: true }]);
  });
});
