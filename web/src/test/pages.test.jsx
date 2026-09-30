import { describe, test, expect } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import Home from '../pages/Home.jsx';
import Watch from '../pages/Watch.jsx';

const card = (over = {}) => ({
  id: '1',
  title: 'Guitar build day',
  durationS: 600,
  publishedAt: null,
  minTier: 'free',
  views: 10,
  chatCount: 3,
  thumbnail: null,
  ...over,
});

const session = { user: null, requireSignIn: () => {} };

function renderWatch(id = '1') {
  return render(
    <MemoryRouter initialEntries={[`/watch/${id}`]}>
      <Routes>
        <Route path="/watch/:id" element={<Watch session={session} />} />
      </Routes>
    </MemoryRouter>,
  );
}

const counts = (over = {}) => ({ all: 2, video: 1, short: 0, live: 1, members: 1, ...over });

describe('Home (videos dashboard)', () => {
  test('lists videos with their tier badge, type label, and chip counts', async () => {
    mockApi({
      '/videos': {
        videos: [
          card({ kind: 'video' }),
          card({ id: '2', title: 'Members stream', minTier: 'plus', kind: 'live' }),
        ],
        counts: counts(),
      },
    });
    render(
      <MemoryRouter>
        <Home />
      </MemoryRouter>,
    );
    expect(await screen.findByText('Guitar build day')).toBeTruthy();
    expect(screen.getByText('Members stream')).toBeTruthy();
    expect(screen.getByText('Plus')).toBeTruthy();
    expect(screen.getByText('Streamed')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Live 1' }).getAttribute('aria-pressed')).toBe('false');
    expect(screen.getByRole('button', { name: 'All 2' }).getAttribute('aria-pressed')).toBe('true');
  });

  test('chips and sort ask the server for that slice', async () => {
    mockApi({ '/videos': { videos: [card()], counts: counts() } });
    render(
      <MemoryRouter>
        <Home />
      </MemoryRouter>,
    );
    fireEvent.click(await screen.findByRole('button', { name: /^Shorts/ }));
    await waitFor(() => expect(fetch.mock.calls.some(([u]) => String(u).includes('kind=short'))).toBe(true));
    fireEvent.click(screen.getByRole('button', { name: /^Members only/ }));
    await waitFor(() => expect(fetch.mock.calls.some(([u]) => String(u).includes('members=1'))).toBe(true));
    fireEvent.change(screen.getByLabelText('Sort videos'), { target: { value: 'views' } });
    await waitFor(() => expect(fetch.mock.calls.some(([u]) => String(u).includes('sort=views'))).toBe(true));
  });

  test('searches on the server and says how many matched', async () => {
    mockApi({
      '/videos': { videos: [card({ id: '2', title: 'Truck repair' })], counts: counts({ all: 1 }) },
    });
    render(
      <MemoryRouter initialEntries={['/?q=truck']}>
        <Home />
      </MemoryRouter>,
    );
    expect(await screen.findByText('Truck repair')).toBeTruthy();
    expect(fetch.mock.calls[0][0]).toContain('q=truck');
    expect(screen.getByText(/1 result for/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Clear search' })).toBeTruthy();
  });

  test('explains how to import when there are no videos', async () => {
    mockApi({ '/videos': { videos: [], counts: counts({ all: 0, video: 0, live: 0, members: 0 }) } });
    render(
      <MemoryRouter>
        <Home />
      </MemoryRouter>,
    );
    expect(await screen.findByText('No streams yet')).toBeTruthy();
  });
});

describe('Watch', () => {
  test('locked video shows the members message and no chat', async () => {
    mockApi({
      '/videos/1': { video: { ...card({ minTier: 'premium' }), description: '', locked: true, hls: null } },
      '/videos/1/view': { ok: true },
    });
    renderWatch();
    expect(await screen.findByText('Premium members only')).toBeTruthy();
    expect(screen.queryByText('Live chat replay')).toBeNull();
    expect(document.querySelector('video')).toBeNull();
  });

  test('unlocked video shows the player and chat', async () => {
    mockApi({
      '/videos/1': {
        video: { ...card(), description: 'Sides laminated', locked: false, hls: 'https://x/video.m3u8' },
      },
      '/videos/1/view': { ok: true },
      '/videos/1/chat': { messages: [] },
    });
    renderWatch();
    expect(await screen.findByText('Live chat replay')).toBeTruthy();
    expect(document.querySelector('video')).not.toBeNull();
    expect(screen.getByText('Sides laminated')).toBeTruthy();
  });

  test('shows a readable error when the video is missing', async () => {
    mockApi({});
    renderWatch('404');
    expect(await screen.findByText('Not mocked')).toBeTruthy();
  });
});
