import { describe, test, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import SignInDialog from '../components/SignInDialog.jsx';
import StudioEmail from '../components/StudioEmail.jsx';

function fakeApi(routes) {
  const calls = [];
  globalThis.fetch = vi.fn(async (url, opts = {}) => {
    const path = String(url)
      .replace(/^\/api/, '')
      .split('?')[0];
    calls.push([path, opts.method || 'GET', opts.body ? JSON.parse(opts.body) : null]);
    const hit = routes[path] || [404, { error: 'Not mocked' }];
    return new Response(JSON.stringify(hit[1]), { status: hit[0] });
  });
  return calls;
}

async function signUp({ news }) {
  const calls = fakeApi({
    '/sign-in-options': [200, { google: false }],
    '/auth/sign-up/email': [200, { user: { id: 1 } }],
    '/account/marketing': [200, { on: true }],
    '/me': [200, { user: { id: 1, username: 'newbie' } }],
  });
  const onSignedIn = vi.fn();
  render(<SignInDialog initialMode="signup" onClose={() => {}} onSignedIn={onSignedIn} />);
  fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'new@example.com' } });
  fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'newbie' } });
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'a-long-password' } });
  fireEvent.click(screen.getByLabelText('I’m 13 or older'));
  if (news) fireEvent.click(screen.getByLabelText(/Email me news from JimBob/));
  fireEvent.click(screen.getByRole('button', { name: 'Create account' }));
  await waitFor(() => expect(onSignedIn).toHaveBeenCalled());
  return calls;
}

describe('News emails at sign-up', () => {
  test('the box starts unticked; ticking it opts the new member in, marked as from sign-up', async () => {
    const calls = await signUp({ news: true });
    expect(calls).toContainEqual(['/account/marketing', 'PUT', { on: true, source: 'signup' }]);
  });

  test('left unticked, nobody is opted in', async () => {
    const calls = await signUp({ news: false });
    expect(calls.some(([path]) => path === '/account/marketing')).toBe(false);
  });
});

describe('Studio → Email list', () => {
  test('shows how many people asked for news and offers the CSV', async () => {
    fakeApi({
      '/studio/email': [200, { enabled: false, from: null, templates: [], suppressed: 0, recent: [] }],
      '/studio/email/preview/verify_email': [200, { subject: 's', html: '', text: '' }],
      '/studio/email-list': [200, { total: 12, members: 9, imported: 3, bySource: {}, waitingToConfirm: 2 }],
    });
    render(<StudioEmail />);
    expect(await screen.findByText(/9 with a site account, 3 from an imported list/)).toBeTruthy();
    expect(screen.getByText(/2 more said yes but haven’t confirmed/)).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Download the list (CSV)' }).getAttribute('href')).toBe(
      '/api/studio/email-list.csv',
    );
  });
});
