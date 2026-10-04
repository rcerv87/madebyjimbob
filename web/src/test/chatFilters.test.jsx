import { describe, test, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import ChatPanel from '../components/ChatPanel.jsx';

const msg = (id, offsetMs, body, author, over = {}) => ({
  id: String(id),
  source: 'youtube',
  kind: 'text',
  author,
  authorPhoto: null,
  body,
  mentions: [],
  offsetMs,
  postedLive: true,
  replyTo: null,
  ...over,
});
const chat = [
  msg(1, 1000, 'Is free will real?', '@User1'),
  msg(2, 2000, 'Depends what you mean', '@User2', {
    replyTo: { id: '1', author: '@User1', body: 'Is free will real?' },
  }),
  msg(3, 3000, 'pizza time', '@Other'),
];

function setup(routes) {
  globalThis.fetch = vi.fn(async (url) => {
    const path = String(url)
      .replace(/^\/api/, '')
      .split('?')[0];
    const body = routes[path];
    return new Response(JSON.stringify(body ?? { error: 'Not mocked' }), { status: body ? 200 : 404 });
  });
  render(
    <MemoryRouter>
      <ChatPanel
        videoId="7"
        timeMs={60_000}
        getTimeMs={() => 60_000}
        onSeek={() => {}}
        session={{ user: null, requireSignIn: () => {} }}
      />
    </MemoryRouter>,
  );
}
const asked = () => fetch.mock.calls.map(([u]) => decodeURIComponent(String(u)));

describe('chat search (MBJ-218)', () => {
  test('words and @names search the whole video; matches are highlighted; Clear goes back', async () => {
    setup({
      '/videos/7/chat': { messages: chat },
      '/videos/7/chat/search': { messages: [chat[0]], more: false },
    });
    await screen.findByText('pizza time');
    fireEvent.click(screen.getByRole('button', { name: 'Search the chat' }));
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search the chat' }), {
      target: { value: 'free @User1' },
    });
    expect(await screen.findByText('1 found')).toBeTruthy();
    expect(asked().some((u) => u.includes('/chat/search?q=free&who=User1&live=1'))).toBe(true);
    expect(screen.queryByText('pizza time')).toBeNull();
    expect(document.querySelector('.chat-msg mark').textContent).toBe('free');

    fireEvent.click(screen.getByRole('button', { name: 'Super chats' }));
    await waitFor(() => expect(asked().some((u) => u.includes('only=paid'))).toBe(true));
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
    expect(await screen.findByText('pizza time')).toBeTruthy();
  });
});

describe('search box names', () => {
  test('typing @ pops up names from the whole video; picking one fills it in', async () => {
    setup({
      '/videos/7/chat': { messages: chat },
      '/videos/7/chat/names': { names: ['User1', 'UserFromEarlier'] },
      '/videos/7/chat/search': { messages: [], more: false },
    });
    await screen.findByText('pizza time');
    fireEvent.click(screen.getByRole('button', { name: 'Search the chat' }));
    const box = screen.getByRole('searchbox', { name: 'Search the chat' });
    fireEvent.change(box, { target: { value: 'free @us', selectionStart: 8 } });
    const list = await screen.findByRole('listbox', { name: 'People in this video’s chat' });
    expect(await within(list).findByRole('button', { name: '@UserFromEarlier' })).toBeTruthy();
    fireEvent.mouseDown(within(list).getByRole('button', { name: '@User1' }));
    expect(box.value).toBe('free @User1 ');
  });

  test('tapping a name in the chat while the search box is open puts it in the search', async () => {
    setup({
      '/videos/7/chat': { messages: chat },
      '/videos/7/chat/search': { messages: [], more: false },
    });
    await screen.findByText('pizza time');
    fireEvent.click(screen.getByRole('button', { name: 'Search the chat' }));
    fireEvent.click(screen.getByRole('button', { name: '@Other' }));
    expect(screen.getByRole('searchbox', { name: 'Search the chat' }).value).toBe('@Other ');
  });
});

describe('conversations (MBJ-222)', () => {
  test('a picture menu shows the whole conversation the message belongs to', async () => {
    setup({
      '/videos/7/chat': { messages: chat },
      '/videos/7/chat/conversation/2': { messages: [chat[0], chat[1]] },
    });
    await screen.findByText('pizza time');
    fireEvent.click(screen.getByRole('button', { name: 'Options for User2' }));
    fireEvent.click(screen.getByRole('button', { name: 'Show this conversation' }));
    expect(await screen.findByText(/Conversation started by User1 · 2 messages/)).toBeTruthy();
    expect(screen.queryByText('pizza time')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Show everyone' }));
    expect(await screen.findByText('pizza time')).toBeTruthy();
  });
});

describe('super chat colors', () => {
  test('by amount: yellow, green, blue, red, gold', async () => {
    const { paidLevel } = await import('../components/ChatPanel.jsx');
    expect(
      ['$2.00', '$4.99', '$5.00', '$10.00', '$25.00', '$50.00', '$500.00', 'CA$7.00', ''].map(paidLevel),
    ).toEqual(['yellow', 'yellow', 'green', 'blue', 'red', 'gold', 'gold', 'green', 'yellow']);
  });
});
