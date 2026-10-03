import { describe, test, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import ChatPanel from '../components/ChatPanel.jsx';
import NameCard from '../components/NameCard.jsx';
import Account from '../pages/Account.jsx';

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
      .filter(
        ([url, o = {}]) => String(url).split('?')[0] === `/api${path}` && (o.method || 'GET') === method,
      )
      .map(([, o]) => (o.body ? JSON.parse(o.body) : null));
}

const msg = (id, body, profile) => ({
  id: String(id),
  source: 'native',
  kind: 'text',
  author: profile,
  profile,
  body,
  mentions: [],
  offsetMs: id * 1000,
  postedLive: true,
  replyTo: null,
});

const card = (moderation) =>
  render(
    <MemoryRouter>
      <NameCard name="Pal" profile="Pal" moderation={moderation} />
    </MemoryRouter>,
  );

describe('favorite members (Premium)', () => {
  test('free and Plus members see what Favorite does instead of colors', () => {
    fakeApi({});
    card({ me: 'Me', premium: false, favorites: new Map() });
    fireEvent.click(screen.getByRole('button', { name: 'Pal' }));
    expect(screen.queryByRole('button', { name: 'Favorite teal' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /★ Favorite/ }));
    expect(screen.getByText(/highlighted in their color in every chat/)).toBeTruthy();
  });

  test('Premium members pick a color, and can remove it', async () => {
    const sent = fakeApi({
      'PUT /account/favorites/Pal': [200, { favorites: [{ username: 'Pal', color: 'teal' }], active: true }],
      'DELETE /account/favorites/Pal': [200, { favorites: [], active: true }],
    });
    const onChanged = vi.fn();
    const { unmount } = card({ me: 'Me', premium: true, favorites: new Map(), onChanged });
    fireEvent.click(screen.getByRole('button', { name: 'Pal' }));
    fireEvent.click(screen.getByRole('button', { name: 'Favorite teal' }));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    expect(sent('PUT', '/account/favorites/Pal')).toEqual([{ color: 'teal' }]);
    unmount();

    card({ me: 'Me', premium: true, favorites: new Map([['pal', 'teal']]), onChanged });
    fireEvent.click(screen.getByRole('button', { name: 'Pal' }));
    expect(screen.getByRole('button', { name: 'Favorite teal' }).getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    await waitFor(() => expect(sent('DELETE', '/account/favorites/Pal')).toHaveLength(1));
  });

  test('favorites are highlighted in chat; this chat’s highlight wins', async () => {
    localStorage.removeItem('mbj.chatHighlights');
    fakeApi({
      '/videos/7/chat': [200, { messages: [msg(1, 'from a pal', 'Pal'), msg(2, 'from bob', 'Bob')] }],
    });
    const user = { username: 'Me', tier: 'premium', favorites: [{ username: 'pal', color: 'teal' }] };
    render(
      <MemoryRouter>
        <ChatPanel
          videoId="7"
          timeMs={60_000}
          getTimeMs={() => 60_000}
          onSeek={() => {}}
          session={{ user, requireSignIn: () => {} }}
        />
      </MemoryRouter>,
    );
    const row = async (text) => (await screen.findByText(text)).closest('.chat-msg');
    expect((await row('from a pal')).classList.contains('hl-teal')).toBe(true);
    expect((await row('from bob')).classList.contains('hl')).toBe(false);

    fireEvent.click(screen.getByRole('button', { name: 'Options for Pal' }));
    fireEvent.click(screen.getByRole('button', { name: 'Highlight red' }));
    expect((await row('from a pal')).classList.contains('hl-red')).toBe(true);
  });

  test('Account settings list favorites to recolor or remove, and say when they’re paused', async () => {
    const sent = fakeApi({
      '/account/favorites': [200, { favorites: [{ username: 'Pal', color: 'teal' }], active: true }],
      'PUT /account/favorites/Pal': [200, { favorites: [{ username: 'Pal', color: 'pink' }], active: true }],
    });
    const onUserChanged = vi.fn();
    const { unmount } = render(
      <MemoryRouter>
        <Account session={{ user: { username: 'Me', tier: 'premium' } }} onUserChanged={onUserChanged} />
      </MemoryRouter>,
    );
    const select = await screen.findByLabelText('Color for Pal');
    fireEvent.change(select, { target: { value: 'pink' } });
    await waitFor(() => expect(onUserChanged).toHaveBeenCalled());
    expect(sent('PUT', '/account/favorites/Pal')).toEqual([{ color: 'pink' }]);
    unmount();

    fakeApi({
      '/account/favorites': [200, { favorites: [{ username: 'Pal', color: 'teal' }], active: false }],
    });
    render(
      <MemoryRouter>
        <Account session={{ user: { username: 'Me', tier: 'free' } }} onUserChanged={() => {}} />
      </MemoryRouter>,
    );
    expect(await screen.findByText(/only highlight while you’re on Premium/)).toBeTruthy();
    expect(screen.queryByLabelText('Color for Pal')).toBeNull();
    expect(screen.getByRole('button', { name: 'Remove' })).toBeTruthy();
  });
});

describe('chat help', () => {
  test('the ? explains mentions, replies, highlights, and favorites', async () => {
    fakeApi({ '/videos/7/chat': [200, { messages: [] }] });
    render(
      <MemoryRouter>
        <ChatPanel
          videoId="7"
          timeMs={0}
          getTimeMs={() => 0}
          onSeek={() => {}}
          live
          session={{ user: null, requireSignIn: () => {} }}
        />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'How the chat works' }));
    const dialog = screen.getByRole('dialog', { name: 'How the chat works' });
    for (const text of ['Tap a name', 'Tap a picture', 'Reply', 'Highlight', 'Joined late?']) {
      expect(dialog.textContent).toContain(text);
    }
    fireEvent.click(screen.getByRole('button', { name: 'Got it' }));
    expect(screen.queryByRole('dialog', { name: 'How the chat works' })).toBeNull();
  });
});
