import { describe, test, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import SignInDialog, { googleError } from '../components/SignInDialog.jsx';
import PickUsername from '../components/PickUsername.jsx';

function fakeApi(routes) {
  const calls = [];
  globalThis.fetch = vi.fn(async (url, opts = {}) => {
    const path = String(url).replace(/^\/api/, '');
    calls.push([path, opts.body ? JSON.parse(opts.body) : null]);
    const hit = routes[path] || [404, { error: 'Not mocked' }];
    return new Response(JSON.stringify(hit[1]), { status: hit[0] });
  });
  return calls;
}

describe('Sign in with Google', () => {
  test('the button shows only when Google is set up, and sends you to Google and back to this page', async () => {
    const assign = vi.fn();
    vi.stubGlobal('location', { ...window.location, pathname: '/watch/4', search: '?t=90', assign });
    const calls = fakeApi({
      '/sign-in-options': [200, { google: true }],
      '/auth/sign-in/social': [200, { url: 'https://accounts.google.com/o/oauth2/auth?x=1', redirect: true }],
    });
    render(<SignInDialog onClose={() => {}} onSignedIn={() => {}} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Continue with Google' }));
    await waitFor(() => expect(assign).toHaveBeenCalledWith('https://accounts.google.com/o/oauth2/auth?x=1'));
    expect(calls).toContainEqual([
      '/auth/sign-in/social',
      { provider: 'google', callbackURL: '/watch/4?t=90', errorCallbackURL: '/?auth=google' },
    ]);
    vi.unstubAllGlobals();
  });

  test('no button without Google keys; a problem coming back from Google is explained', async () => {
    fakeApi({ '/sign-in-options': [200, { google: false }] });
    render(
      <SignInDialog
        onClose={() => {}}
        onSignedIn={() => {}}
        initialError={googleError('account_not_linked')}
      />,
    );
    expect(screen.getByRole('alert').textContent).toMatch(/already an account with that Google email/);
    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalled());
    expect(screen.queryByRole('button', { name: 'Continue with Google' })).toBeNull();
    expect(googleError('something_new')).toMatch(/didn’t go through/);
  });
});

describe('Pick your username', () => {
  const user = { id: 7, username: 'SamRivera4821', needsUsername: true };

  test('saves the chosen name, showing why when it is refused', async () => {
    const onDone = vi.fn();
    const calls = fakeApi({
      '/account/username': [400, { error: 'That username is taken. Please pick another.' }],
    });
    render(<PickUsername user={user} onDone={onDone} />);
    fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'Sam' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save username' }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/taken/);
    expect(onDone).not.toHaveBeenCalled();

    fakeApi({ '/account/username': [200, { username: 'SamTheMan' }] });
    fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'SamTheMan' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save username' }));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(calls[0]).toEqual(['/account/username', { username: 'Sam' }]);
  });

  test('or keeps the made-up one', async () => {
    const onDone = vi.fn();
    const calls = fakeApi({ '/account/username': [200, { username: user.username }] });
    render(<PickUsername user={user} onDone={onDone} />);
    fireEvent.click(screen.getByRole('button', { name: 'Keep SamRivera4821' }));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(calls).toEqual([['/account/username', { keep: true }]]);
  });
});
