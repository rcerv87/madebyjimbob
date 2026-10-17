import { describe, test, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

// A stand-in for the phone's Google account picker. Like a real Capacitor plugin it answers to any name, `then` too.
const calls = [];
const picker = { result: { result: { idToken: 'google-id-token' } }, fail: null };
vi.mock('@capgo/capacitor-social-login', () => ({
  SocialLogin: new Proxy(
    {},
    {
      get: (_t, name) => {
        if (name === 'then') return (resolve) => resolve('not the plugin');
        return async (arg) => {
          calls.push([name, arg]);
          if (name === 'login' && picker.fail) throw picker.fail;
          return name === 'login' ? picker.result : undefined;
        };
      },
    },
  ),
}));

const { default: SignInDialog } = await import('../components/SignInDialog.jsx');

const asApp = (platform = 'android') => {
  globalThis.Capacitor = { isNativePlatform: () => true, getPlatform: () => platform };
};
function fakeServer(routes) {
  const sent = [];
  globalThis.fetch = vi.fn(async (url, init = {}) => {
    const path = new URL(String(url)).pathname.replace(/^\/api/, '');
    sent.push([init.method || 'GET', path, init.body ? JSON.parse(init.body) : null]);
    const [status, body, headers] = routes[path] || [404, { error: 'Not mocked' }];
    return new Response(JSON.stringify(body), { status, headers });
  });
  return sent;
}
const OPTIONS = { google: true, googleClientId: 'web.apps.googleusercontent.com', googleIosClientId: null };
const open = (onSignedIn = () => {}) =>
  render(
    <MemoryRouter>
      <SignInDialog onClose={() => {}} onSignedIn={onSignedIn} />
    </MemoryRouter>,
  );

afterEach(() => {
  delete globalThis.Capacitor;
  localStorage.clear();
  calls.length = 0;
  picker.fail = null;
});

describe('Sign in with Google in the apps', () => {
  test('Android: the phone’s account picker, then the server checks Google’s token and signs in', async () => {
    asApp('android');
    const sent = fakeServer({
      '/sign-in-options': [200, OPTIONS],
      '/auth/sign-in/social': [200, { redirect: false, token: 't' }, { 'set-auth-token': 'app-token' }],
      '/me': [200, { user: { username: 'SamRivera1234', needsUsername: true } }],
    });
    const onSignedIn = vi.fn();
    open(onSignedIn);
    fireEvent.click(await screen.findByRole('button', { name: 'Continue with Google' }));
    await waitFor(() => expect(onSignedIn).toHaveBeenCalled());
    expect(calls[0]).toEqual([
      'initialize',
      { google: { webClientId: OPTIONS.googleClientId, mode: 'online' } },
    ]);
    expect(calls[1]).toEqual(['login', { provider: 'google', options: { scopes: ['email', 'profile'] } }]);
    expect(sent).toContainEqual([
      'POST',
      '/auth/sign-in/social',
      { provider: 'google', idToken: { token: 'google-id-token' } },
    ]);
    expect(localStorage.getItem('mbj_app_token')).toBe('app-token');
    // A Google sign-up still picks a username next, like on the website.
    expect(onSignedIn).toHaveBeenCalledWith(
      { username: 'SamRivera1234', needsUsername: true },
      { isNew: true },
    );
  });

  test('backing out of the picker says nothing; an unlinked account gets the website’s explanation', async () => {
    asApp('android');
    fakeServer({
      '/sign-in-options': [200, OPTIONS],
      '/auth/sign-in/social': [401, { code: 'OAUTH_LINK_ERROR', message: 'account not linked' }],
    });
    open();
    picker.fail = Object.assign(new Error('User cancelled the selector'), { code: 'USER_CANCELLED' });
    fireEvent.click(await screen.findByRole('button', { name: 'Continue with Google' }));
    await waitFor(() => expect(calls.some(([n]) => n === 'login')).toBe(true));
    expect(screen.queryByText(/didn’t go through|cancelled/i)).toBeNull();

    picker.fail = null;
    fireEvent.click(screen.getByRole('button', { name: 'Continue with Google' }));
    expect(await screen.findByText(/already an account with that Google email/)).toBeTruthy();
  });

  test('iPhone: hidden until its own client id is set, then it uses it', async () => {
    asApp('ios');
    fakeServer({ '/sign-in-options': [200, OPTIONS] });
    const first = open();
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    expect(screen.queryByRole('button', { name: 'Continue with Google' })).toBeNull();
    first.unmount();

    fakeServer({
      '/sign-in-options': [200, { ...OPTIONS, googleIosClientId: 'ios.apps.googleusercontent.com' }],
      '/auth/sign-in/social': [500, { message: 'stop here' }],
    });
    open();
    fireEvent.click(await screen.findByRole('button', { name: 'Continue with Google' }));
    await waitFor(() => expect(calls.some(([n]) => n === 'initialize')).toBe(true));
    expect(calls.find(([n]) => n === 'initialize')[1]).toEqual({
      google: {
        iOSClientId: 'ios.apps.googleusercontent.com',
        iOSServerClientId: OPTIONS.googleClientId,
        mode: 'online',
      },
    });
  });
});
