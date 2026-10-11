import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import Home from '../pages/Home.jsx';
import WatchedButton from '../components/WatchedButton.jsx';
import UpNext from '../components/UpNext.jsx';
import {
  watchState,
  bingeQueue,
  stateOf,
  saveProgress,
  markWatched,
  markUnwatched,
  watchingAgain,
  readLocal,
} from '../progress.js';
import { setSignedIn } from '../api.js';

const v = (id, title, publishedAt, progressMs, durationS = 600) => ({
  id: String(id),
  title,
  publishedAt,
  progressMs,
  durationS,
  kind: 'video',
  minTier: 'free',
  views: 0,
  chatCount: 0,
  thumbnail: null,
});
// Newest first, as the site lists them.
const videos = [
  v(5, 'Newest, not started', '2026-05-01', 0),
  v(4, 'Halfway', '2026-04-01', 300_000),
  v(3, 'Finished', '2026-03-01', 590_000),
  v(2, 'Older, not started', '2026-02-01', 5_000),
  v(1, 'Oldest, just begun', '2026-01-01', 60_000),
];

beforeEach(() => {
  window.localStorage.clear();
  setSignedIn(false);
});

describe('watched, in progress, unwatched', () => {
  test('the last 30 seconds count as finished, the first 10 as not started', () => {
    expect(watchState(0, 600)).toBe('unwatched');
    expect(watchState(10_000, 600)).toBe('unwatched');
    expect(watchState(10_001, 600)).toBe('progress');
    expect(watchState(569_999, 600)).toBe('progress');
    expect(watchState(570_000, 600)).toBe('watched');
    expect(watchState(999_000, null)).toBe('progress'); // no known length: can't be finished
  });

  test('signed out, it comes from this browser', () => {
    saveProgress('9', 400_000);
    expect(stateOf({ id: '9', durationS: 600 })).toBe('progress');
    expect(stateOf({ id: '9', durationS: 600, progressMs: 0 })).toBe('unwatched'); // the account wins
  });

  test('the binge queue: in progress first, then the rest oldest to newest; finished ones left out', () => {
    expect(bingeQueue(videos).map((x) => x.id)).toEqual(['4', '1', '2', '5']);
    expect(bingeQueue(videos, { newestFirst: true }).map((x) => x.id)).toEqual(['4', '1', '5', '2']);
    // The video being watched stays in its queue even once it's finished.
    expect(bingeQueue(videos, { keepId: '3' }).map((x) => x.id)).toEqual(['4', '1', '2', '3', '5']);
  });

  test('a mark made by hand isn’t undone by the player’s own saves, until the video is opened again', () => {
    const video = { id: '7', durationS: 600 };
    markWatched(video);
    expect(readLocal('7')).toBe(600_000);
    saveProgress('7', 120_000); // the page saving where the player is
    expect(readLocal('7')).toBe(600_000);
    watchingAgain('7');
    saveProgress('7', 120_000);
    expect(readLocal('7')).toBe(120_000);
    markUnwatched(video);
    expect(readLocal('7')).toBe(null);
  });
});

describe('Videos page', () => {
  const open = (path = '/') => {
    mockApi({ '/videos': { videos, counts: { all: 5, video: 5, short: 0, live: 0, members: 0 } } });
    render(
      <MemoryRouter initialEntries={[path]}>
        <Home />
      </MemoryRouter>,
    );
  };
  const titles = (root = document) => [...root.querySelectorAll('.card h3')].map((h) => h.textContent);

  test('chips with counts filter the list; Keep watching shows what’s in progress', async () => {
    open();
    const chips = await screen.findByRole('group', { name: 'Filter by what you’ve watched' });
    expect(within(chips).getByRole('button', { name: /^Unwatched ?2$/ })).toBeTruthy();
    expect(within(chips).getByRole('button', { name: /^In progress ?2$/ })).toBeTruthy();
    expect(within(chips).getByRole('button', { name: /^Watched ?1$/ })).toBeTruthy();

    const keep = screen.getByRole('region', { name: 'Keep watching' });
    expect(titles(keep)).toEqual(['Halfway', 'Oldest, just begun']);

    fireEvent.click(within(chips).getByRole('button', { name: /^Unwatched ?2$/ }));
    expect(titles()).toEqual(['Newest, not started', 'Older, not started']);
    expect(screen.queryByRole('region', { name: 'Keep watching' })).toBeNull();
    fireEvent.click(within(chips).getByRole('button', { name: /^Watched ?1$/ }));
    expect(titles()).toEqual(['Finished']);
    fireEvent.click(within(chips).getByRole('button', { name: /^Watched ?1$/ })); // tap again to clear
    expect(titles().length).toBe(7); // the list of 5 plus Keep watching's 2
  });

  test('Play all starts the binge queue at what’s in progress, in the order the page is sorted', async () => {
    open();
    const link = await screen.findByRole('link', { name: '▶ Play all 4 unwatched' });
    expect(link.getAttribute('href')).toBe('/watch/4?list=unwatched&order=new');
  });

  test('the filter is in the address, so it can be bookmarked', async () => {
    open('/?watch=progress');
    await screen.findByRole('group', { name: 'Filter by what you’ve watched' });
    expect(titles()).toEqual(['Halfway', 'Oldest, just begun']);
  });
});

describe('on a video page', () => {
  test('Mark as watched puts your place at the end; tapping again takes it back', () => {
    globalThis.fetch = vi.fn();
    render(<WatchedButton video={{ id: '8', durationS: 600, resumeMs: null }} />);
    fireEvent.click(screen.getByRole('button', { name: 'Mark as watched' }));
    expect(readLocal('8')).toBe(600_000);
    const done = screen.getByRole('button', { name: '✓ Watched' });
    expect(done.getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(done);
    expect(readLocal('8')).toBe(null);
    expect(screen.getByRole('button', { name: 'Mark as watched' })).toBeTruthy();
  });

  test('the binge queue shows as a playlist that links back to Unwatched', () => {
    render(
      <MemoryRouter>
        <UpNext
          queue={[videos[1], videos[4]]}
          index={0}
          playlist={{ id: 'unwatched', title: 'Not watched yet', virtual: true }}
          autoplay
          onAutoplay={() => {}}
          hrefFor={(x) => `/watch/${x.id}?list=unwatched`}
        />
      </MemoryRouter>,
    );
    expect(screen.getByRole('link', { name: 'Not watched yet' }).getAttribute('href')).toBe(
      '/?watch=unwatched',
    );
    expect(screen.getByText(/1 \/ 2/)).toBeTruthy();
  });
});
