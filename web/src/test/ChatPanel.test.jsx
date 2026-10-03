import { describe, test, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import ChatPanel from '../components/ChatPanel.jsx';

const msg = (id, offsetMs, body, over = {}) => ({
  id: String(id),
  source: 'youtube',
  kind: 'text',
  author: 'Viewer',
  authorPhoto: null,
  body,
  amount: null,
  mentions: [],
  offsetMs,
  ...over,
});

function renderPanel({ timeMs = 0, user = null, requireSignIn = () => {} } = {}) {
  return render(
    <MemoryRouter>
      <ChatPanel videoId="7" timeMs={timeMs} getTimeMs={() => timeMs} session={{ user, requireSignIn }} />
    </MemoryRouter>,
  );
}

describe('ChatPanel', () => {
  test('live: someone joining 20 minutes in gets the last 10 minutes of chat, not just from now on', async () => {
    mockApi({
      '/videos/7/chat': {
        messages: [msg(1, 600_000, 'said ten minutes ago'), msg(2, 1_195_000, 'just now')],
      },
    });
    render(
      <MemoryRouter>
        <ChatPanel
          videoId="7"
          timeMs={1_200_000}
          getTimeMs={() => 1_200_000}
          session={{ user: null, requireSignIn: () => {} }}
          live
        />
      </MemoryRouter>,
    );
    expect(await screen.findByText('said ten minutes ago')).toBeTruthy();
    expect(screen.getByText('just now')).toBeTruthy();
    const froms = globalThis.fetch.mock.calls.map(([u]) =>
      Number(new URL(String(u), 'http://x').searchParams.get('from')),
    );
    expect(Math.min(...froms)).toBe(600_000); // 10 minutes back from 20:00, through the next 2-minute window
    expect(Math.max(...froms)).toBe(1_320_000);
  });

  test('shows only messages at or before the playhead', async () => {
    mockApi({ '/videos/7/chat': { messages: [msg(1, 1000, 'first'), msg(2, 50_000, 'later')] } });
    const { rerender } = renderPanel({ timeMs: 10_000 });
    expect(await screen.findByText('first')).toBeTruthy();
    expect(screen.queryByText('later')).toBeNull();

    rerender(
      <MemoryRouter>
        <ChatPanel
          videoId="7"
          timeMs={60_000}
          getTimeMs={() => 60_000}
          session={{ user: null, requireSignIn: () => {} }}
        />
      </MemoryRouter>,
    );
    expect(await screen.findByText('later')).toBeTruthy();
  });

  test('highlights mentions of the signed-in user and renders super chats', async () => {
    mockApi({
      '/videos/7/chat': {
        messages: [
          msg(1, 0, 'nice one @ruben', { mentions: ['ruben'] }),
          msg(2, 0, 'take my money', { kind: 'paid', amount: '$20.00' }),
        ],
      },
    });
    renderPanel({ user: { username: 'Ruben' } });
    const mention = await screen.findByText('@ruben');
    expect(mention.className).toBe('mention');
    expect(mention.closest('li').className).toContain('mentions-me');
    expect(screen.getByText('$20.00')).toBeTruthy();
  });

  test('joins the video room over WebSocket (the session cookie says who you are)', async () => {
    mockApi({ '/videos/7/chat': { messages: [] } });
    renderPanel();
    const ws = FakeWebSocket.instances[0];
    ws.onopen();
    expect(ws.sent[0]).toEqual({ type: 'join', videoId: '7' });
  });

  test('highlights whole YouTube handles but not emails', async () => {
    mockApi({ '/videos/7/chat': { messages: [msg(1, 0, '@Bro-tl7qq TOS, mail me@site.com')] } });
    renderPanel();
    expect((await screen.findByText('@Bro-tl7qq')).className).toBe('mention');
    expect(document.querySelectorAll('.mention')).toHaveLength(1);
  });

  test('clicking a message timestamp seeks the player there', async () => {
    mockApi({ '/videos/7/chat': { messages: [msg(1, 65_000, 'at 1:05')] } });
    const onSeek = vi.fn();
    render(
      <MemoryRouter>
        <ChatPanel
          videoId="7"
          timeMs={90_000}
          getTimeMs={() => 90_000}
          onSeek={onSeek}
          session={{ user: null, requireSignIn: () => {} }}
        />
      </MemoryRouter>,
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Play from 1:05' }));
    expect(onSeek).toHaveBeenCalledWith(65_000);
  });

  test('shows "Jump to latest" when scrolled up and hides it after jumping', async () => {
    mockApi({ '/videos/7/chat': { messages: [msg(1, 0, 'hello')] } });
    renderPanel();
    await screen.findByText('hello');
    const list = document.querySelector('.chat-list');
    Object.defineProperty(list, 'scrollHeight', { configurable: true, value: 1000 });
    Object.defineProperty(list, 'clientHeight', { configurable: true, value: 300 });

    list.scrollTop = 100;
    fireEvent.scroll(list);
    const jump = await screen.findByRole('button', { name: 'Jump to latest' });

    fireEvent.click(jump);
    expect(list.scrollTop).toBe(1000);
    expect(screen.queryByRole('button', { name: 'Jump to latest' })).toBeNull();
  });

  test('after a reconnect, fetches messages newer than the last one seen', async () => {
    mockApi({ '/videos/7/chat': { messages: [msg(41, 0, 'seen'), msg(42, 0, 'also seen')] } });
    renderPanel();
    await screen.findByText('also seen');
    const ws = FakeWebSocket.instances[0];
    ws.onopen(); // first connect: no catch-up
    expect(fetch.mock.calls.some(([url]) => String(url).includes('afterId'))).toBe(false);
    ws.onopen(); // reconnect
    expect(fetch.mock.calls.some(([url]) => String(url).includes('afterId=42'))).toBe(true);
  });

  test('asks signed-out viewers to sign in instead of posting', async () => {
    mockApi({ '/videos/7/chat': { messages: [] } });
    const requireSignIn = vi.fn();
    renderPanel({ requireSignIn });
    fireEvent.submit(screen.getByRole('button', { name: 'Send' }).closest('form'));
    expect(requireSignIn).toHaveBeenCalled();
  });
});

describe('linked YouTube accounts in chat', () => {
  test("show the member's site name and tier, with the YouTube name in the tooltip", async () => {
    mockApi({
      '/videos/7/chat': {
        messages: [
          msg(1, 0, 'hello', { author: 'SiteFan', platformName: '@FanOnYT', memberTier: 'premium' }),
        ],
      },
    });
    renderPanel({ timeMs: 5000 });
    const name = await screen.findByText('SiteFan');
    expect(name.getAttribute('title')).toMatch(/@FanOnYT on YouTube/);
    expect(screen.getByText('Premium')).toBeTruthy();
  });

  test('a mention of your linked YouTube handle is highlighted as yours', async () => {
    mockApi({ '/videos/7/chat': { messages: [msg(1, 0, '@fanonyt nice', { mentions: ['fanonyt'] })] } });
    renderPanel({ timeMs: 5000, user: { username: 'SiteFan', linkedHandles: ['fanonyt'] } });
    expect((await screen.findByText('@fanonyt')).closest('li').className).toContain('mentions-me');
  });
});
