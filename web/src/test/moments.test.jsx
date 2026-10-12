import { describe, test, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import Moments, { minuteBars, describeMinute } from '../components/Moments.jsx';
import { createClock } from '../clock.js';

const video = { id: '4', durationS: 600 }; // 10 minutes
const base = {
  minutes: 10,
  kinds: ['funny', 'interesting', 'fire', 'boring', 'cringe'],
  chat: [0, 4, 0, 0, 0, 20, 0, 0, 0, 2],
  reactions: [
    { minute: 2, kind: 'funny', score: 3, people: 3 },
    { minute: 2, kind: 'fire', score: 1, people: 1 },
    { minute: 7, kind: 'boring', score: 1, people: 2 },
  ],
  notes: [
    {
      id: 1,
      offsetMs: 306000,
      endMs: null,
      body: 'He really goes off',
      author: 'ann',
      profile: 'ann',
      mine: false,
    },
    {
      id: 2,
      offsetMs: 120000,
      endMs: 240000,
      body: 'Boring call-in',
      author: 'Bob',
      profile: 'Bob',
      mine: false,
    },
    {
      id: 3,
      offsetMs: 30000,
      endMs: null,
      body: 'My reminder',
      author: 'me',
      profile: 'me',
      mine: true,
      private: true,
    },
    {
      id: 4,
      offsetMs: 10000,
      endMs: null,
      body: 'From someone muted',
      author: 'troll',
      profile: 'troll',
      mine: false,
    },
  ],
  mine: [{ id: 9, kind: 'funny', offsetMs: 125000, endMs: null }],
};

function setup({ user, data = base } = {}) {
  const calls = [];
  globalThis.fetch = vi.fn(async (url, opts = {}) => {
    const path = String(url).replace(/^\/api/, '');
    calls.push([path, opts.method || 'GET', opts.body ? JSON.parse(opts.body) : null]);
    if (path === '/videos/4/moments') return Response.json(data);
    return Response.json({ ok: true });
  });
  const clock = createClock();
  const onSeek = vi.fn();
  const session = { user: user ?? null, requireSignIn: vi.fn(), refreshUser: vi.fn() };
  render(
    <MemoryRouter>
      <Moments video={video} clock={clock} onSeek={onSeek} session={session} />
    </MemoryRouter>,
  );
  return { calls, clock, onSeek, session };
}
const me = {
  id: 5,
  username: 'me',
  tier: 'premium',
  favorites: [{ username: 'bob', color: 'teal' }],
  hidden: [{ username: 'Troll' }],
};
// The strip is 1000px wide in these tests, so 100px is one minute of this 10-minute video.
const strip = () => {
  const el = screen.getByRole('group', { name: /minute by minute/ });
  el.getBoundingClientRect = () => ({ left: 0, width: 1000, top: 0, height: 26, right: 1000, bottom: 26 });
  return el;
};

// The test browser's pointer events carry no position, so these are mouse events under the pointer names.
const pointer = (el, type, clientX) =>
  fireEvent(el, new MouseEvent(type, { bubbles: true, cancelable: true, clientX, button: 0 }));

describe('the minute-by-minute picture', () => {
  test('each minute takes the color of its leading reaction; reactions outshine chat alone', () => {
    const bars = minuteBars(base);
    expect(bars).toHaveLength(10);
    expect([bars[2].top, bars[7].top, bars[5].top, bars[0].top]).toEqual(['funny', 'boring', null, null]);
    expect(bars[2].level).toBe(1); // the most-reacted minute
    expect(bars[5].level).toBeCloseTo(0.52); // the busiest chat minute, no reactions
    expect(bars[7].level).toBeGreaterThan(bars[5].level);
    expect(bars[0].level).toBe(0);
    expect(describeMinute(bars[2])).toBe('2:00 · Funny 3, Fire 1');
    expect(describeMinute(bars[5])).toBe('5:00 · 20 chat messages');
  });
});

describe('Moments under the player', () => {
  test('notes are listed with favorites first, muted members left out; tapping one jumps there', async () => {
    const { onSeek } = setup({ user: me });
    const list = await screen.findByRole('list');
    const rows = within(list).getAllByRole('listitem');
    expect(rows.map((li) => li.querySelector('.moments-note-text').textContent)).toEqual([
      'Boring call-in', // Bob is a favorite
      'My reminder',
      'He really goes off',
    ]);
    expect(rows[0].className).toContain('hl-teal');
    expect(within(rows[0]).getByRole('button', { name: '2:00 to 4:00' })).toBeTruthy();
    expect(within(rows[1]).getByText('Just for me')).toBeTruthy();
    fireEvent.click(within(rows[2]).getByRole('button', { name: '5:06' }));
    expect(onSeek).toHaveBeenCalledWith(306000);

    fireEvent.click(screen.getByLabelText('Favorites only'));
    expect(within(screen.getByRole('list')).getAllByRole('listitem')).toHaveLength(1);
  });

  test('one tap reacts at the current moment; a reaction you already gave this minute shows as on', async () => {
    const { calls, clock } = setup({ user: me });
    await screen.findByRole('list');
    clock.set(125_500); // minute 2, where "mine" has Funny
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /Funny/ }).getAttribute('aria-pressed')).toBe('true'),
    );
    expect(screen.getByRole('button', { name: /Fire/ }).getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(screen.getByRole('button', { name: /Fire/ }));
    await waitFor(() =>
      expect(calls).toContainEqual(['/videos/4/reactions', 'POST', { kind: 'fire', offsetMs: 125500 }]),
    );
  });

  test('tap the strip to jump; drag across it to pick a stretch, then react to or note the whole stretch', async () => {
    const { calls, onSeek } = setup({ user: me });
    await screen.findByRole('list');
    const el = strip();
    pointer(el, 'pointerdown', 500);
    pointer(el, 'pointerup', 500);
    expect(onSeek).toHaveBeenCalledWith(300000);

    pointer(el, 'pointerdown', 200);
    pointer(el, 'pointermove', 300);
    pointer(el, 'pointermove', 400);
    pointer(el, 'pointerup', 400);
    expect(onSeek).toHaveBeenCalledTimes(1); // a drag doesn't jump
    expect(screen.getByText(/Stretch picked: 2:00 to 4:00/)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /Boring/ }));
    await waitFor(() =>
      expect(calls).toContainEqual([
        '/videos/4/reactions',
        'POST',
        { kind: 'boring', offsetMs: 120000, endMs: 240000 },
      ]),
    );
  });

  test('add a note at the current moment, public or just for me; delete your own', async () => {
    const { calls, clock } = setup({ user: me });
    await screen.findByRole('list');
    clock.set(65_000);
    fireEvent.click(screen.getByRole('button', { name: '+ Add a note' }));
    const input = screen.getByLabelText('Note at 1:05');
    fireEvent.change(input, { target: { value: '  Great point here ' } });
    fireEvent.click(screen.getByLabelText('Just for me'));
    fireEvent.click(screen.getByRole('button', { name: 'Save note' }));
    await waitFor(() =>
      expect(calls).toContainEqual([
        '/videos/4/notes',
        'POST',
        { text: 'Great point here', offsetMs: 65000, endMs: null, private: true },
      ]),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(calls).toContainEqual(['/notes/3', 'DELETE', null]));
  });

  test('signed out you can look and jump, and reacting or adding a note asks you to sign in', async () => {
    const { calls, session } = setup();
    await screen.findByRole('list');
    expect(within(screen.getByRole('list')).getAllByRole('listitem')).toHaveLength(4);
    expect(screen.queryByLabelText('Favorites only')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Funny/ }));
    fireEvent.click(screen.getByRole('button', { name: '+ Add a note' }));
    expect(session.requireSignIn).toHaveBeenCalledTimes(2);
    expect(calls.filter(([, method]) => method !== 'GET')).toEqual([]);
  });

  test('a timed-out member can react but not add notes', async () => {
    setup({ user: { ...me, timeoutUntil: new Date(Date.now() + 86400000).toISOString() } });
    await screen.findByRole('list');
    expect(screen.getByRole('button', { name: '+ Add a note' }).disabled).toBe(true);
    expect(screen.getByText(/You’re timed out until/)).toBeTruthy();
    expect(screen.getByRole('button', { name: /Funny/ }).disabled).toBe(false);
  });
});
