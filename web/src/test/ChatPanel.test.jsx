import { describe, test, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import ChatPanel from '../components/ChatPanel.jsx';

const msg = (id, offsetMs, body, over = {}) => ({
  id: String(id), source: 'youtube', kind: 'text', author: 'Viewer', authorPhoto: null,
  body, amount: null, mentions: [], offsetMs, ...over,
});

function renderPanel({ timeMs = 0, user = null, requireSignIn = () => {} } = {}) {
  return render(
    <ChatPanel videoId="7" timeMs={timeMs} getTimeMs={() => timeMs} session={{ user, requireSignIn }} />
  );
}

describe('ChatPanel', () => {
  test('shows only messages at or before the playhead', async () => {
    mockApi({ '/videos/7/chat': { messages: [msg(1, 1000, 'first'), msg(2, 50_000, 'later')] } });
    const { rerender } = renderPanel({ timeMs: 10_000 });
    expect(await screen.findByText('first')).toBeTruthy();
    expect(screen.queryByText('later')).toBeNull();

    rerender(<ChatPanel videoId="7" timeMs={60_000} getTimeMs={() => 60_000} session={{ user: null, requireSignIn: () => {} }} />);
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

  test('joins the video room over WebSocket with the saved token', async () => {
    localStorage.setItem('mbjb_token', 'tok123');
    mockApi({ '/videos/7/chat': { messages: [] } });
    renderPanel();
    const ws = FakeWebSocket.instances[0];
    ws.onopen();
    expect(ws.sent[0]).toEqual({ type: 'join', videoId: '7', token: 'tok123' });
  });

  test('asks signed-out viewers to sign in instead of posting', async () => {
    mockApi({ '/videos/7/chat': { messages: [] } });
    const requireSignIn = vi.fn();
    renderPanel({ requireSignIn });
    fireEvent.submit(screen.getByRole('button', { name: 'Send' }).closest('form'));
    expect(requireSignIn).toHaveBeenCalled();
  });
});
