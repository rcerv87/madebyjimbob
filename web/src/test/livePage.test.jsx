import { describe, test, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import Live from '../pages/Live.jsx';

// The players are faked: these tests are about which one plays and from where.
const players = vi.hoisted(() => ({ live: [], recording: [] }));
vi.mock('../liveHls.js', async (orig) => {
  const real = await orig();
  return {
    ...real,
    attachLive: (el, src) => {
      players.live.push(src);
      const stop = () => {};
      stop.control = { seekBy: () => true, toLive: () => {} };
      return stop;
    },
    attachRecording: (el, url, startAt) => {
      players.recording.push(Math.round(startAt));
      return () => {};
    },
  };
});

afterEach(() => vi.restoreAllMocks());

describe('/live', () => {
  test('while live with a recording: rewind controls, Listen, and the live chat', async () => {
    globalThis.fetch = vi.fn(async (url) => {
      const u = String(url);
      const body = u.includes('/api/live')
        ? {
            configured: true,
            online: true,
            hls: '/live/hls/stream.m3u8',
            dvr: {
              url: 'https://pub.example/dvr/r1/master.m3u8',
              startedAt: new Date().toISOString(),
              gapS: 0,
              videoId: 9,
            },
          }
        : u.includes('/chat')
          ? { messages: [], comments: [] }
          : '';
      return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status: 200 });
    });
    render(
      <MemoryRouter>
        <Live session={{ user: null, requireSignIn: () => {} }} />
      </MemoryRouter>,
    );
    expect(await screen.findByRole('button', { name: '🎧 Listen' })).toBeTruthy();
    expect(screen.getByLabelText('Rewind the stream')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Back 1 minute' })).toBeTruthy();
    expect(await screen.findByText('Live chat')).toBeTruthy();
  });

  test('jumping forward in the recording lands where you asked, not back at live', async () => {
    players.live.length = 0;
    players.recording.length = 0;
    globalThis.fetch = vi.fn(async (url) => {
      const u = String(url);
      const body = u.includes('/api/live')
        ? {
            configured: true,
            online: true,
            hls: '/live/hls/stream.m3u8',
            dvr: {
              url: 'https://pub.example/dvr/r1/master.m3u8',
              startedAt: new Date(Date.now() - 600_000).toISOString(),
              gapS: 0,
              videoId: 9,
            },
          }
        : u.includes('/chat')
          ? { messages: [], comments: [] }
          : '';
      return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status: 200 });
    });
    render(
      <MemoryRouter>
        <Live session={{ user: null, requireSignIn: () => {} }} />
      </MemoryRouter>,
    );
    await screen.findByRole('button', { name: 'Back 1 minute' });
    // Nobody has rewound yet: the live feed plays, not the recording.
    expect(players.live).toEqual(['/live/hls/stream.m3u8']);
    expect(players.recording).toEqual([]);
    const livesBefore = players.live.length;
    fireEvent.click(screen.getByRole('button', { name: 'Back 1 minute' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Back 1 minute' }));
    await act(async () => {});
    const back = players.recording.at(-1);
    expect(back).toBeGreaterThan(450); // ~10 min in, 2 minutes back
    // Forward past what the player had loaded: the recording loads again from there.
    fireEvent.click(screen.getByRole('button', { name: 'Forward 10 seconds' }));
    await act(async () => {});
    expect(players.recording.at(-1) - back).toBeGreaterThanOrEqual(9);
    expect(players.recording.at(-1) - back).toBeLessThanOrEqual(11);
    expect(players.live.length).toBe(livesBefore);

    // From the recording to 8 s behind live: the recording plays it (it reaches to ~6 s behind), no switch to live.
    const slider = screen.getByLabelText('Rewind the stream');
    const jump = (behind) => {
      fireEvent.change(slider, { target: { value: String(Number(slider.max) - behind) } });
      fireEvent.pointerUp(slider);
    };
    jump(8);
    await act(async () => {});
    expect(Number(slider.max) - players.recording.at(-1)).toBeGreaterThanOrEqual(7);
    expect(Number(slider.max) - players.recording.at(-1)).toBeLessThanOrEqual(9);
    expect(players.live.length).toBe(livesBefore);

    // A short load pause near live (every jump causes one) keeps playing the recording; it used to switch to live.
    const video = document.querySelector('video');
    Object.defineProperty(video, 'currentTime', { value: 590, configurable: true });
    fireEvent.waiting(video);
    await act(async () => {});
    expect(players.live.length).toBe(livesBefore);

    // Closer than the recording reaches (3 s behind): live.
    jump(3);
    await act(async () => {});
    expect(players.live.length).toBe(livesBefore + 1);
  });

  test('when not live, says so', async () => {
    globalThis.fetch = vi.fn(
      async () => new Response(JSON.stringify({ configured: true, online: false }), { status: 200 }),
    );
    render(
      <MemoryRouter>
        <Live session={{ user: null, requireSignIn: () => {} }} />
      </MemoryRouter>,
    );
    expect(await screen.findByText('JimBob isn’t live right now')).toBeTruthy();
  });
});
