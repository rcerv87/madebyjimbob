import { describe, test, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useNavigate } from 'react-router-dom';
import Watch from '../pages/Watch.jsx';
import Comments from '../components/Comments.jsx';
import TopBar from '../components/TopBar.jsx';

const videoData = (id, over = {}) => ({
  video: {
    id,
    title: `Video ${id}`,
    durationS: 600,
    publishedAt: null,
    minTier: 'free',
    views: 1,
    chatCount: 0,
    thumbnail: null,
    description: '',
    locked: false,
    hls: `https://x/${id}.m3u8`,
    resumeMs: null,
    likes: 0,
    myVote: 0,
    ...over,
  },
});

// fetch stand-in: `answers` maps a path to a body, or to a function returning one (or a promise of one).
function fakeApi(answers) {
  globalThis.fetch = vi.fn(async (url) => {
    const path = String(url)
      .replace(/^\/api/, '')
      .split('?')[0];
    const answer = typeof answers[path] === 'function' ? await answers[path]() : answers[path];
    if (answer === undefined) return Response.json({ error: 'Not mocked' }, { status: 404 });
    return Response.json(answer);
  });
}
const calls = (path, method = 'GET') =>
  fetch.mock.calls.filter(
    ([url, opts]) => String(url).split('?')[0] === `/api${path}` && (opts?.method || 'GET') === method,
  );

function Go({ to }) {
  const navigate = useNavigate();
  return <button onClick={() => navigate(to)}>Go to {to}</button>;
}

function WatchAt({ path, session }) {
  return (
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/watch/:id" element={<Watch session={session} />} />
      </Routes>
      <Go to="/watch/2" />
    </MemoryRouter>
  );
}

const signedOut = { user: null, requireSignIn: () => {} };
const signedIn = { user: { id: '9', username: 'fan', tier: 'plus' }, requireSignIn: () => {} };

describe('Watch page', () => {
  test('signing in reloads the video in place: same player, one view', async () => {
    fakeApi({
      '/videos/1': videoData('1'),
      '/videos/1/view': { ok: true },
      '/videos/1/chat': { messages: [] },
      '/videos/1/comments': { total: 0, nextOffset: null, comments: [] },
      '/videos': { videos: [] },
    });
    const { rerender } = render(<WatchAt path="/watch/1" session={signedOut} />);
    await screen.findByText('Live chat replay');
    const player = document.querySelector('video');

    rerender(<WatchAt path="/watch/1" session={signedIn} />);
    await waitFor(() => expect(calls('/videos/1')).toHaveLength(2));
    expect(document.querySelector('video')).toBe(player);
    expect(screen.queryByText('Loading…')).toBeNull();
    expect(calls('/videos/1/view', 'POST')).toHaveLength(1);
  });

  test('a members video unlocks when the viewer signs in', async () => {
    let tier = 'free';
    fakeApi({
      '/videos/1': () => videoData('1', tier === 'plus' ? {} : { minTier: 'plus', locked: true, hls: null }),
      '/videos/1/view': { ok: true },
      '/videos/1/chat': { messages: [] },
      '/videos/1/comments': { total: 0, nextOffset: null, comments: [] },
      '/videos': { videos: [] },
    });
    const { rerender } = render(<WatchAt path="/watch/1" session={signedOut} />);
    expect(await screen.findByText('Plus members only')).toBeTruthy();
    tier = 'plus';
    rerender(<WatchAt path="/watch/1" session={signedIn} />);
    expect(await screen.findByText('Live chat replay')).toBeTruthy();
    expect(document.querySelector('video')).not.toBeNull();
  });

  test('a late answer for the previous video never replaces the one now open', async () => {
    let answerFirst;
    fakeApi({
      '/videos/1': () => new Promise((resolve) => (answerFirst = resolve)),
      '/videos/2': videoData('2'),
      '/videos/1/view': { ok: true },
      '/videos/2/view': { ok: true },
      '/videos/2/chat': { messages: [] },
      '/videos/2/comments': { total: 0, nextOffset: null, comments: [] },
      '/videos': { videos: [] },
    });
    render(<WatchAt path="/watch/1" session={signedOut} />);
    await waitFor(() => expect(answerFirst).toBeTypeOf('function'));
    fireEvent.click(screen.getByText('Go to /watch/2'));
    expect(await screen.findByRole('heading', { name: 'Video 2' })).toBeTruthy();
    await act(async () => answerFirst(videoData('1')));
    expect(screen.queryByRole('heading', { name: 'Video 1' })).toBeNull();
    expect(screen.getByRole('heading', { name: 'Video 2' })).toBeTruthy();
  });
});

describe('Comments', () => {
  test('"+ Add" follows the video while the form is open', async () => {
    fakeApi({ '/videos/4/comments': { total: 0, nextOffset: null, comments: [] } });
    let now = 5_000;
    render(<Comments videoId="4" session={signedIn} getTimeMs={() => now} onSeek={() => {}} />);
    fireEvent.focus(await screen.findByPlaceholderText('Add a comment…'));
    expect(screen.getByRole('button', { name: '+ Add 0:05' })).toBeTruthy();
    now = 65_000;
    expect(await screen.findByRole('button', { name: '+ Add 1:05' })).toBeTruthy();
  });
});

describe('Top bar search', () => {
  test('the box follows the URL, so a cleared search is cleared there too', async () => {
    render(
      <MemoryRouter initialEntries={['/?q=debate']}>
        <TopBar user={null} onSignIn={() => {}} onSignOut={() => {}} onMenu={() => {}} />
        <Go to="/" />
      </MemoryRouter>,
    );
    expect(screen.getByRole('textbox', { name: 'Search streams' }).value).toBe('debate');
    fireEvent.click(screen.getByText('Go to /'));
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'Search streams' }).value).toBe(''));
  });
});
