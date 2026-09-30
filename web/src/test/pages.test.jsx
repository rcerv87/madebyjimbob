import { describe, test, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import Home from '../pages/Home.jsx';
import Watch from '../pages/Watch.jsx';

const card = (over = {}) => ({
  id: '1', title: 'Guitar build day', durationS: 600, publishedAt: null,
  minTier: 'free', views: 10, chatCount: 3, thumbnail: null, ...over,
});

const session = { user: null, requireSignIn: () => {} };

function renderWatch(id = '1') {
  return render(
    <MemoryRouter initialEntries={[`/watch/${id}`]}>
      <Routes><Route path="/watch/:id" element={<Watch session={session} />} /></Routes>
    </MemoryRouter>
  );
}

describe('Home', () => {
  test('lists videos with their tier badge', async () => {
    mockApi({ '/videos': { videos: [card(), card({ id: '2', title: 'Members stream', minTier: 'plus' })] } });
    render(<MemoryRouter><Home /></MemoryRouter>);
    expect(await screen.findByText('Guitar build day')).toBeTruthy();
    expect(screen.getByText('Members stream')).toBeTruthy();
    expect(screen.getByText('Plus')).toBeTruthy();
  });

  test('filters by the search query', async () => {
    mockApi({ '/videos': { videos: [card(), card({ id: '2', title: 'Truck repair' })] } });
    render(<MemoryRouter initialEntries={['/?q=truck']}><Home /></MemoryRouter>);
    expect(await screen.findByText('Truck repair')).toBeTruthy();
    expect(screen.queryByText('Guitar build day')).toBeNull();
    expect(screen.getByText(/1 result for/)).toBeTruthy();
  });

  test('explains how to import when there are no videos', async () => {
    mockApi({ '/videos': { videos: [] } });
    render(<MemoryRouter><Home /></MemoryRouter>);
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
      '/videos/1': { video: { ...card(), description: 'Sides laminated', locked: false, hls: 'https://x/video.m3u8' } },
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
