import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { WelcomeDialog, WelcomeChecklist } from '../components/WelcomeSteps.jsx';

const user = { id: 1, username: 'newbie', email: 'new@example.com', tier: 'free' };
const fresh = { emailConfirmed: false, pushOn: false, youtubeLinked: false, member: false, dismissed: false };

function setup(info) {
  const calls = [];
  let current = info;
  globalThis.fetch = vi.fn(async (url, opts = {}) => {
    const path = String(url).replace(/^\/api/, '');
    calls.push([path, opts.method || 'GET']);
    if (path === '/account/welcome/dismiss') current = { ...current, dismissed: true };
    if (path === '/account/welcome') return Response.json(current);
    return Response.json({ ok: true });
  });
  return calls;
}
const wrap = (node) => render(<MemoryRouter>{node}</MemoryRouter>);

beforeEach(() => window.localStorage.clear());

describe('Welcome steps', () => {
  test('after sign-up: each step can be done or skipped, and closing leaves you where you were', async () => {
    const calls = setup(fresh);
    const onClose = vi.fn();
    wrap(<WelcomeDialog user={user} onClose={onClose} />);
    expect(await screen.findByText('Welcome, newbie')).toBeTruthy();
    expect(screen.getByText('Confirm your email')).toBeTruthy();
    expect(screen.getByText('Link your YouTube name')).toBeTruthy();
    expect(screen.getByText('See membership options')).toBeTruthy();
    // This test browser can't do push, so that step isn't offered.
    expect(screen.queryByText('Turn on notifications on this device')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Send the link again' }));
    expect(await screen.findByText(/Sent\. Check new@example\.com/)).toBeTruthy();
    expect(calls).toContainEqual(['/auth/send-verification-email', 'POST']);
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.click(screen.getAllByRole('button', { name: 'Skip' })[1]); // YouTube
    expect(screen.getByText(/· skipped/)).toBeTruthy();
    expect(JSON.parse(window.localStorage.getItem('mbjb_welcome_skipped'))).toEqual(['youtube']);

    fireEvent.click(screen.getByRole('link', { name: 'Have a look' }));
    expect(onClose).toHaveBeenCalled(); // following a step's link closes the welcome
  });

  test('says All set when nothing is left', async () => {
    setup({ ...fresh, emailConfirmed: true, youtubeLinked: true, member: true });
    wrap(<WelcomeDialog user={user} onClose={() => {}} />);
    expect(await screen.findByRole('button', { name: 'All set' })).toBeTruthy();
    expect(screen.getAllByText(/· done/)).toHaveLength(3);
  });

  test('Account settings shows what’s left until it’s hidden or finished', async () => {
    const calls = setup({ ...fresh, emailConfirmed: true });
    wrap(<WelcomeChecklist user={user} />);
    expect(await screen.findByText('Finish setting up (2 left)')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Hide this' }));
    await waitFor(() => expect(calls).toContainEqual(['/account/welcome/dismiss', 'POST']));
    await waitFor(() => expect(screen.queryByText(/Finish setting up/)).toBeNull());
  });

  test('nothing shows once every step is done', async () => {
    setup({ ...fresh, emailConfirmed: true, youtubeLinked: true, member: true });
    const { container } = wrap(<WelcomeChecklist user={user} />);
    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalled());
    expect(container.querySelector('#welcome')).toBeNull();
  });
});
