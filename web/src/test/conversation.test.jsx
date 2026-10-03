import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import ChatPanel from '../components/ChatPanel.jsx';
import Comments from '../components/Comments.jsx';
import VideoCard from '../components/VideoCard.jsx';
import Watch from '../pages/Watch.jsx';

const msg = (id, offsetMs, body, over = {}) => ({
  id: String(id),
  source: 'youtube',
  kind: 'text',
  author: '@Viewer',
  authorPhoto: null,
  body,
  amount: null,
  mentions: [],
  offsetMs,
  postedLive: true,
  replyTo: null,
  ...over,
});

const bubble = (id, offsetMs, body, over = {}) => ({
  id: String(id),
  parentId: null,
  source: 'native',
  author: 'sam',
  authorPhoto: null,
  isCreator: false,
  body,
  likes: 0,
  pinned: false,
  postedAt: new Date().toISOString(),
  offsetMs,
  replyTo: null,
  replyCount: 2,
  replies: [],
  ...over,
});

const signedIn = { user: { username: 'ruben' }, requireSignIn: () => {} };

function panel(props = {}) {
  return render(
    <MemoryRouter>
      <ChatPanel
        videoId="7"
        timeMs={60_000}
        getTimeMs={() => 60_000}
        onSeek={() => {}}
        session={signedIn}
        {...props}
      />
    </MemoryRouter>,
  );
}

describe('chat: live only vs live + replay', () => {
  beforeEach(() => {
    mockApi({
      '/videos/7/chat': {
        messages: [
          msg(1, 1000, 'from the live stream'),
          msg(2, 2000, 'watched it later', { source: 'native', author: 'sam', postedLive: false }),
        ],
        comments: [bubble(9, 3000, 'this moment is key')],
      },
    });
  });

  test('defaults to the original live chat and counts what later viewers added', async () => {
    panel();
    expect(await screen.findByText('from the live stream')).toBeTruthy();
    expect(screen.queryByText('watched it later')).toBeNull();
    expect(screen.queryByText('this moment is key')).toBeNull();
    expect(screen.getByRole('button', { name: 'Live only' }).getAttribute('aria-pressed')).toBe('true');

    fireEvent.click(screen.getByRole('button', { name: '+2 from later viewers' }));
    expect(screen.getByText('watched it later')).toBeTruthy();
    expect(screen.getByText('replay')).toBeTruthy();
    expect(screen.getByText('this moment is key')).toBeTruthy();
    expect(screen.getByText('Comment')).toBeTruthy();
  });

  test('a comment bubble opens its thread', async () => {
    const onOpenThread = vi.fn();
    localStorage.setItem('mbjb_chat_view', 'all');
    panel({ onOpenThread });
    fireEvent.click(await screen.findByRole('button', { name: 'View thread · 2 replies' }));
    expect(onOpenThread).toHaveBeenCalledWith('9');
  });
});

describe('chat: replies', () => {
  test('tapping a name mentions them; Reply in their picture menu quotes the message and sends replyToId', async () => {
    mockApi({ '/videos/7/chat': { messages: [msg(1, 1000, 'hot take')] } });
    panel();
    fireEvent.click(await screen.findByRole('button', { name: '@Viewer' }));
    const input = screen.getByLabelText('Chat message');
    expect(input.value).toBe('@Viewer ');
    expect(screen.queryByText(/Replying to/)).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Options for Viewer' }));
    fireEvent.click(screen.getByRole('button', { name: 'Reply' }));
    expect(input.value).toBe('@Viewer ');
    expect(screen.getByText(/Replying to/).textContent).toContain('hot take');

    globalThis.fetch = vi.fn(async () =>
      Response.json({
        message: msg(5, 60_000, '@Viewer no way', {
          source: 'native',
          author: 'ruben',
          postedLive: false,
          replyTo: { id: '1', author: '@Viewer', body: 'hot take', offsetMs: 1000 },
        }),
      }),
    );
    fireEvent.change(input, { target: { value: '@Viewer no way' } });
    fireEvent.submit(input.closest('form'));

    await waitFor(() => expect(fetch).toHaveBeenCalled());
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toMatchObject({ replyToId: '1' });
    // Their own post is replay chat, so the view switches to show it, with its quote.
    await waitFor(() =>
      expect(
        [...document.querySelectorAll('.chat-msg')].some((li) => li.textContent.includes('@Viewer no way')),
      ).toBe(true),
    );
    expect(screen.getByRole('button', { name: 'Live + replay' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByTitle('Show the original message').textContent).toContain('hot take');
  });

  test('a picture menu shows only that person, and highlights them in a color for this chat', async () => {
    localStorage.removeItem('mbj.chatHighlights');
    const messages = [
      msg(1, 1000, 'first'),
      msg(2, 2000, 'other one', { author: '@BigSue' }),
      msg(3, 3000, 'again'),
    ];
    mockApi({
      '/videos/7/chat': { messages },
      '/videos/8/chat': { messages },
      // One person's messages come from the server, across the whole video.
      '/videos/7/chat/search': { messages: [messages[0], messages[2]], more: false },
    });
    const { unmount } = panel();
    await screen.findByText('other one');
    fireEvent.click(screen.getAllByRole('button', { name: 'Options for Viewer' })[0]);
    fireEvent.click(screen.getByRole('button', { name: 'Show only their messages' }));
    expect(await screen.findByText('first')).toBeTruthy();
    expect(screen.queryByText('other one')).toBeNull();
    expect(fetch.mock.calls.some(([u]) => String(u).includes('/chat/search?from=Viewer'))).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Show everyone' }));
    expect(await screen.findByText('other one')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Options for BigSue' }));
    fireEvent.click(screen.getByRole('button', { name: 'Highlight purple' }));
    const row = (text) => screen.getByText(text).closest('.chat-msg');
    expect(row('other one').classList.contains('hl-purple')).toBe(true);
    expect(row('first').classList.contains('hl')).toBe(false);
    // One person per color: purple moves to Viewer.
    fireEvent.click(screen.getAllByRole('button', { name: 'Options for Viewer' })[0]);
    expect(screen.getByRole('button', { name: 'Highlight purple' }).title).toContain('BigSue has purple');
    fireEvent.click(screen.getByRole('button', { name: 'Highlight purple' }));
    expect(row('first').classList.contains('hl-purple')).toBe(true);
    expect(row('other one').classList.contains('hl')).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Options for BigSue' }));
    fireEvent.click(screen.getByRole('button', { name: 'Highlight green' }));
    unmount();

    // Kept after a refresh of the same chat; a different video's chat starts clean.
    const second = panel();
    await screen.findByText('other one');
    expect(row('other one').classList.contains('hl-green')).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Options for BigSue' }));
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
    expect(row('other one').classList.contains('hl')).toBe(false);
    expect(row('first').classList.contains('hl-purple')).toBe(true);
    second.unmount();

    panel({ videoId: '8' });
    await screen.findByText('other one');
    expect(row('first').classList.contains('hl')).toBe(false);
  });

  test('@ suggests names from the chat', async () => {
    mockApi({ '/videos/7/chat': { messages: [msg(1, 1000, 'hi', { author: '@BigSue' })] } });
    panel();
    await screen.findByText('hi');
    const input = screen.getByLabelText('Chat message');
    fireEvent.change(input, { target: { value: 'hey @bi', selectionStart: 7 } });
    const option = within(await screen.findByRole('listbox')).getByRole('button', { name: '@BigSue' });
    fireEvent.mouseDown(option);
    expect(input.value).toBe('hey @BigSue ');
  });
});

describe('comments: context and timestamps', () => {
  test('replies to replies quote what they answer; times are clickable', async () => {
    const onSeek = vi.fn();
    mockApi({
      '/videos/4/comments': {
        total: 3,
        nextOffset: null,
        comments: [
          bubble(1, null, 'first point at 12:05', {
            source: 'youtube',
            author: '@Alice',
            replyCount: 2,
            replies: [
              bubble(2, null, 'disagree', {
                parentId: '1',
                author: '@Bob',
                replyTo: { id: '1', author: '@Alice', body: 'first point' },
              }),
              bubble(3, 65_000, 'why?', {
                parentId: '1',
                author: '@Alice',
                replyTo: { id: '2', author: '@Bob', body: 'disagree' },
              }),
            ],
          }),
        ],
      },
    });
    render(<Comments videoId="4" session={signedIn} onSeek={onSeek} />);
    fireEvent.click(await screen.findByRole('button', { name: '12:05' }));
    expect(onSeek).toHaveBeenCalledWith(725_000);

    fireEvent.click(screen.getByRole('button', { name: '2 replies' }));
    const quotes = screen.getAllByTitle('Show that comment');
    expect(quotes).toHaveLength(1);
    expect(quotes[0].textContent).toContain('disagree');
    fireEvent.click(screen.getByRole('button', { name: 'at 1:05' }));
    expect(onSeek).toHaveBeenCalledWith(65_000);
  });

  test('a new comment can carry the current moment', async () => {
    mockApi({ '/videos/4/comments': { total: 0, nextOffset: null, comments: [] } });
    render(<Comments videoId="4" session={signedIn} getTimeMs={() => 754_000} onSeek={() => {}} />);
    const box = await screen.findByPlaceholderText('Add a comment…');
    fireEvent.focus(box);
    fireEvent.change(box, { target: { value: 'this bit' } });
    fireEvent.click(screen.getByRole('button', { name: '+ Add 12:34' }));
    globalThis.fetch = vi.fn(async () => Response.json({ comment: bubble(8, 754_000, 'this bit') }));
    fireEvent.click(screen.getByRole('button', { name: 'Comment' }));
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({ text: 'this bit', offsetMs: 754_000 });
  });
});

describe('resume where you left off', () => {
  const card = {
    id: '4',
    title: 'Evolution Debate',
    durationS: 1000,
    publishedAt: null,
    minTier: 'free',
    views: 1,
    chatCount: 0,
    thumbnail: null,
  };

  test('video cards show how far the viewer got', () => {
    render(
      <MemoryRouter>
        <VideoCard v={{ ...card, progressMs: 250_000 }} />
      </MemoryRouter>,
    );
    expect(screen.getByRole('progressbar', { name: 'Watched' }).getAttribute('aria-valuenow')).toBe('25');
  });

  test('the watch page resumes from the saved spot and offers to start over', async () => {
    localStorage.setItem('mbjb_progress_4', '754000');
    mockApi({
      '/videos/4': {
        video: { ...card, description: '', locked: false, hls: 'https://x/v.m3u8', resumeMs: null },
      },
      '/videos/4/view': { ok: true },
      '/videos/4/chat': { messages: [] },
      '/videos/4/comments': { total: 0, nextOffset: null, comments: [] },
    });
    render(
      <MemoryRouter initialEntries={['/watch/4']}>
        <Routes>
          <Route path="/watch/:id" element={<Watch session={{ user: null, requireSignIn: () => {} }} />} />
        </Routes>
      </MemoryRouter>,
    );
    expect((await screen.findByText(/Resumed from/)).textContent).toContain('12:34');
    expect(screen.getByRole('button', { name: 'Start over' })).toBeTruthy();
  });

  test('a ?t= link starts at that time instead', async () => {
    localStorage.setItem('mbjb_progress_4', '754000');
    mockApi({
      '/videos/4': {
        video: { ...card, description: '', locked: false, hls: 'https://x/v.m3u8', resumeMs: null },
      },
      '/videos/4/view': { ok: true },
      '/videos/4/chat': { messages: [] },
      '/videos/4/comments': { total: 0, nextOffset: null, comments: [] },
    });
    render(
      <MemoryRouter initialEntries={['/watch/4?t=90']}>
        <Routes>
          <Route path="/watch/:id" element={<Watch session={{ user: null, requireSignIn: () => {} }} />} />
        </Routes>
      </MemoryRouter>,
    );
    await screen.findByText('Evolution Debate');
    expect(screen.queryByText(/Resumed from/)).toBeNull();
  });
});
