import { describe, test, expect, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import Playlist from '../pages/Playlist.jsx';
import UpNext, { EndScreen } from '../components/UpNext.jsx';

const v = (id, title, over = {}) => ({
  id: String(id),
  title,
  kind: 'video',
  durationS: 600,
  publishedAt: null,
  minTier: 'free',
  views: 1,
  chatCount: 0,
  thumbnail: null,
  ...over,
});

describe('Playlist page', () => {
  test('shows the playlist in order with Play all into the playlist', async () => {
    mockApi({
      '/playlists/5': {
        playlist: {
          id: '5',
          title: 'Debates',
          description: 'The big ones',
          source: 'youtube',
          durationS: 1200,
        },
        videos: [v(1, 'First'), v(2, 'Second')],
      },
    });
    render(
      <MemoryRouter initialEntries={['/playlist/5']}>
        <Routes>
          <Route path="/playlist/:id" element={<Playlist />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(await screen.findByRole('heading', { name: 'Debates' })).toBeTruthy();
    expect(screen.getByText(/2 videos · 20:00 total · from YouTube/)).toBeTruthy();
    expect(screen.getByRole('link', { name: '▶ Play all' }).getAttribute('href')).toBe('/watch/1?list=5');
    const links = screen.getAllByRole('link').filter((a) => a.getAttribute('href')?.startsWith('/watch/2'));
    expect(links[0].getAttribute('href')).toBe('/watch/2?list=5');
  });
});

describe('Up next', () => {
  const hrefFor = (x) => `/watch/${x.id}?list=5`;

  test('in a playlist it lists everything with the current position', () => {
    render(
      <MemoryRouter>
        <UpNext
          queue={[v(1, 'First'), v(2, 'Second'), v(3, 'Third')]}
          index={1}
          playlist={{ id: '5', title: 'Debates' }}
          autoplay
          onAutoplay={() => {}}
          hrefFor={hrefFor}
        />
      </MemoryRouter>,
    );
    expect(screen.getByText(/2 \/ 3/)).toBeTruthy();
    expect(screen.getByRole('link', { name: /Second/ }).getAttribute('aria-current')).toBe('true');
    expect(screen.getByRole('link', { name: /Third/ }).getAttribute('href')).toBe('/watch/3?list=5');
  });

  test('outside a playlist it shows just the next video; the Autoplay switch is remembered', () => {
    const onAutoplay = vi.fn();
    render(
      <MemoryRouter>
        <UpNext
          queue={[v(1, 'Newest'), v(2, 'Older')]}
          index={0}
          autoplay
          onAutoplay={onAutoplay}
          hrefFor={hrefFor}
        />
      </MemoryRouter>,
    );
    expect(screen.getByText('Up next')).toBeTruthy();
    expect(screen.getByRole('link', { name: /Older/ })).toBeTruthy();
    fireEvent.click(screen.getByLabelText('Autoplay'));
    expect(onAutoplay).toHaveBeenCalledWith(false);
    expect(localStorage.getItem('mbjb_autoplay')).toBe('off');
  });

  test('the end screen counts down and plays the next video unless cancelled', () => {
    vi.useFakeTimers();
    const onPlay = vi.fn();
    render(<EndScreen next={v(2, 'Older')} seconds={3} onPlay={onPlay} onCancel={() => {}} />);
    expect(screen.getByText('Up next in 3')).toBeTruthy();
    for (let s = 0; s < 3; s++) act(() => vi.advanceTimersByTime(1000));
    expect(screen.queryByText('Up next in 3')).toBeNull();
    expect(onPlay).toHaveBeenCalled();
    vi.useRealTimers();
  });
});
