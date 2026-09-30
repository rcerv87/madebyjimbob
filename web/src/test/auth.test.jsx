import { describe, test, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import SignInDialog from '../components/SignInDialog.jsx';
import AccountNotice from '../components/AccountNotice.jsx';

// fetch stand-in: routes map "METHOD /path" (or "/path") to [status, body].
function fakeApi(routes) {
  globalThis.fetch = vi.fn(async (url, opts = {}) => {
    const path = String(url).replace(/^\/api/, '');
    const hit = routes[`${opts.method || 'GET'} ${path}`] || routes[path] || [404, { error: 'Not mocked' }];
    return new Response(JSON.stringify(hit[1]), { status: hit[0] });
  });
  return (path) =>
    globalThis.fetch.mock.calls
      .filter(([url]) => String(url) === `/api${path}`)
      .map(([, opts]) => JSON.parse(opts.body));
}

const me = {
  user: { id: 1, username: 'Fan', email: 'fan@example.com', emailVerified: false, confirmEmail: true },
};
const type = (label, value) => fireEvent.change(screen.getByLabelText(label), { target: { value } });

describe('sign-in dialog', () => {
  test('signs in by username or by email', async () => {
    const sentTo = fakeApi({
      'POST /auth/sign-in/username': [200, {}],
      'POST /auth/sign-in/email': [200, {}],
      '/me': [200, me],
    });
    const onSignedIn = vi.fn();
    render(<SignInDialog onClose={() => {}} onSignedIn={onSignedIn} />);
    type('Email or username', 'Fan');
    type('Password', 'password1234');
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    await waitFor(() => expect(onSignedIn).toHaveBeenCalledWith(me.user));
    expect(sentTo('/auth/sign-in/username')).toEqual([{ username: 'Fan', password: 'password1234' }]);

    type('Email or username', 'fan@example.com');
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    await waitFor(() => expect(sentTo('/auth/sign-in/email')).toHaveLength(1));
  });

  test('explains a wrong password in plain words', async () => {
    fakeApi({ 'POST /auth/sign-in/username': [401, { code: 'INVALID_USERNAME_OR_PASSWORD', message: 'x' }] });
    render(<SignInDialog onClose={() => {}} onSignedIn={() => {}} />);
    type('Email or username', 'fan');
    type('Password', 'wrong-password');
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/don’t match.*reset your password/);
  });

  test('creating an account needs the 13+ box and sends email, username, and password', async () => {
    const sentTo = fakeApi({ 'POST /auth/sign-up/email': [200, {}], '/me': [200, me] });
    const onSignedIn = vi.fn();
    render(<SignInDialog onClose={() => {}} onSignedIn={onSignedIn} initialMode="signup" />);
    type('Email', 'fan@example.com');
    type('Username', 'Fan');
    type('Password', 'password1234');
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/13 or older/);
    expect(sentTo('/auth/sign-up/email')).toHaveLength(0);

    fireEvent.click(screen.getByLabelText('I’m 13 or older'));
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }));
    await waitFor(() => expect(onSignedIn).toHaveBeenCalled());
    expect(sentTo('/auth/sign-up/email')[0]).toMatchObject({
      email: 'fan@example.com',
      username: 'Fan',
      password: 'password1234',
    });
    expect(sentTo('/auth/sign-up/email')[0]).not.toHaveProperty('tier');
  });

  test('forgot password sends a link without saying whether the account exists', async () => {
    const sentTo = fakeApi({ 'POST /auth/request-password-reset': [200, { status: true }] });
    render(<SignInDialog onClose={() => {}} onSignedIn={() => {}} />);
    fireEvent.click(screen.getByText('Forgot password?'));
    type('Email', 'who@example.com');
    fireEvent.click(screen.getByRole('button', { name: 'Send reset link' }));
    expect(await screen.findByText(/If there’s an account for/)).toBeTruthy();
    expect(sentTo('/auth/request-password-reset')).toEqual([
      { email: 'who@example.com', redirectTo: '/reset-password' },
    ]);
  });
});

describe('account email notice', () => {
  const renderNotice = (user, path = '/') =>
    render(
      <MemoryRouter initialEntries={[path]}>
        <AccountNotice user={user} onUserChanged={() => {}} />
      </MemoryRouter>,
    );

  test('asks unverified members to confirm, and resends the link', async () => {
    const sentTo = fakeApi({ 'POST /auth/send-verification-email': [200, { status: true }] });
    renderNotice(me.user);
    expect(screen.getByText(/Confirm your email/)).toBeTruthy();
    fireEvent.click(screen.getByText('Send it again'));
    expect(await screen.findByText(/Sent\. Check fan@example.com/)).toBeTruthy();
    expect(sentTo('/auth/send-verification-email')[0].email).toBe('fan@example.com');
  });

  test('no nudge to confirm when the server cannot send email', () => {
    fakeApi({});
    renderNotice({ ...me.user, confirmEmail: false });
    expect(screen.queryByText(/Confirm your email/)).toBeNull();
  });

  test('accounts without an email get a box to add one', () => {
    fakeApi({});
    renderNotice({ ...me.user, email: null });
    expect(screen.getByLabelText('Your email')).toBeTruthy();
  });

  test('says thanks after the confirmation link, and nothing for verified members', () => {
    fakeApi({ '/me': [200, me] });
    renderNotice({ ...me.user, emailVerified: true }, '/?verified=1');
    expect(screen.getByText('Thanks! Your email is confirmed.')).toBeTruthy();
    fireEvent.click(screen.getByText('Close'));
    expect(screen.queryByRole('status')).toBeNull();
  });
});

describe('account menu', () => {
  test('the avatar opens who you are and Sign out (the only sign-out on phones)', async () => {
    const { default: TopBar } = await import('../components/TopBar.jsx');
    const onSignOut = vi.fn();
    render(
      <MemoryRouter>
        <TopBar
          user={{ ...me.user, tier: 'free' }}
          onSignIn={() => {}}
          onSignOut={onSignOut}
          onMenu={() => {}}
        />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Account' }));
    expect(screen.getByRole('menu').textContent).toContain('fan@example.com');
    fireEvent.click(screen.getByRole('menuitem', { name: 'Sign out' }));
    expect(onSignOut).toHaveBeenCalled();
    expect(screen.queryByRole('menu')).toBeNull();
  });
});
