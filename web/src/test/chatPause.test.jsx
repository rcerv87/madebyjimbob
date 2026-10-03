import { describe, test, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import ChatPanel from '../components/ChatPanel.jsx';

const msg = (id, offsetMs, body, author = 'Viewer') => ({
  id: String(id),
  source: 'native',
  kind: 'text',
  author,
  profile: author,
  body,
  mentions: [],
  offsetMs,
  postedLive: true,
  replyTo: null,
});

function fakeApi(routes) {
  globalThis.fetch = vi.fn(async (url, opts = {}) => {
    const path = String(url)
      .replace(/^\/api/, '')
      .split('?')[0];
    const hit = routes[`${opts.method || 'GET'} ${path}`] || routes[path] || [404, { error: 'Not mocked' }];
    return new Response(JSON.stringify(hit[1]), { status: hit[0] });
  });
  return (method, path) =>
    globalThis.fetch.mock.calls.filter(
      ([url, o = {}]) => String(url).split('?')[0] === `/api${path}` && (o.method || 'GET') === method,
    );
}

const messages = [
  msg(1, 1000, 'one'),
  msg(2, 2000, 'two', 'Pal'),
  msg(3, 3000, 'three'),
  msg(4, 4000, 'four'),
];
const panel = (timeMs, session) => (
  <MemoryRouter>
    <ChatPanel videoId="7" timeMs={timeMs} getTimeMs={() => timeMs} onSeek={() => {}} session={session} />
  </MemoryRouter>
);
const signedOut = { user: null, requireSignIn: () => {} };

describe('the chat holds still while you use it', () => {
  test('a finger on the chat pauses it; new messages wait behind a button', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    fakeApi({ '/videos/7/chat': [200, { messages }] });
    const { rerender } = render(panel(2500, signedOut));
    await screen.findByText('two');
    const body = document.querySelector('.chat-body');
    fireEvent.touchStart(body);
    rerender(panel(4500, signedOut));
    expect(screen.queryByText('three')).toBeNull();
    expect(screen.getByRole('button', { name: '↓ 2 new messages' })).toBeTruthy();

    // Let go: it resumes 3 s later.
    fireEvent.touchEnd(body);
    act(() => vi.advanceTimersByTime(3100));
    expect(screen.getByText('four')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /new message/ })).toBeNull();
    vi.useRealTimers();
  });

  test('an open menu pauses it until it closes', async () => {
    fakeApi({ '/videos/7/chat': [200, { messages }] });
    const { rerender } = render(panel(2500, signedOut));
    await screen.findByText('two');
    fireEvent.click(screen.getByRole('button', { name: 'Options for Pal' }));
    rerender(panel(4500, signedOut));
    expect(screen.queryByText('four')).toBeNull();
    // Pressing anywhere else closes the menu (as in a browser), then the button catches up.
    const more = screen.getByRole('button', { name: '↓ 2 new messages' });
    fireEvent.pointerDown(more);
    fireEvent.click(more);
    await waitFor(() => expect(screen.getByText('four')).toBeTruthy());
  });
});

describe('chat options (⋯)', () => {
  test('unmute and unblock people, and clear highlights', async () => {
    localStorage.removeItem('mbj.chatHighlights');
    const sent = fakeApi({
      '/videos/7/chat': [200, { messages }],
      'DELETE /account/blocks/Pest': [200, { hidden: [] }],
    });
    const refreshUser = vi.fn();
    const session = {
      user: { username: 'Me', tier: 'free', hidden: [{ username: 'Pest', kind: 'mute' }] },
      requireSignIn: () => {},
      refreshUser,
    };
    render(panel(4500, session));
    await screen.findByText('two');
    fireEvent.click(screen.getByRole('button', { name: 'Options for Pal' }));
    fireEvent.click(screen.getByRole('button', { name: 'Highlight blue' }));

    fireEvent.click(screen.getByRole('button', { name: 'Chat options' }));
    const menu = screen.getByRole('dialog', { name: 'Chat options' });
    expect(menu.textContent).toContain('Pest');
    fireEvent.click(screen.getByRole('button', { name: 'Unmute' }));
    await waitFor(() => expect(refreshUser).toHaveBeenCalled());
    expect(sent('DELETE', '/account/blocks/Pest')).toHaveLength(1);

    expect(menu.textContent).toContain('Pal');
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
    expect(screen.getByText('two').closest('.chat-msg').classList.contains('hl')).toBe(false);
  });
});
