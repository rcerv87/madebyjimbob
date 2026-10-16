import { describe, test, expect, vi, afterEach } from 'vitest';

// A stand-in for the Android plugin. Like a real Capacitor plugin it answers to any method name, `then` included,
// which is what once kept every call from reaching it.
const calls = [];
vi.mock('@capgo/capacitor-media-session', () => ({
  MediaSession: new Proxy(
    {},
    {
      get: (_target, name) => {
        if (name === 'then') return (resolve) => resolve('not the plugin');
        return (...args) => {
          calls.push([name, ...args]);
          return Promise.resolve();
        };
      },
    },
  ),
}));

const {
  setMediaInfo,
  setMediaPlaying,
  setMediaAction,
  setMediaPosition,
  clearMediaInfo,
  mediaControlsAvailable,
} = await import('../mediaControls.js');

const flush = () => new Promise((r) => setTimeout(r, 0));
afterEach(() => {
  delete globalThis.Capacitor;
  calls.length = 0;
  vi.useRealTimers();
});

describe('lock-screen controls on the website', () => {
  test('use the browser’s Media Session', () => {
    const session = { setActionHandler: vi.fn(), setPositionState: vi.fn() };
    Object.defineProperty(navigator, 'mediaSession', { value: session, configurable: true });
    globalThis.MediaMetadata = class {
      constructor(m) {
        Object.assign(this, m);
      }
    };
    expect(mediaControlsAvailable()).toBe(true);
    setMediaInfo({ title: 'Evolution Debate', artist: 'JimBob', artwork: 'https://x/thumb.jpg' });
    expect(session.metadata.title).toBe('Evolution Debate');
    expect(session.metadata.artwork[0].src).toBe('https://x/thumb.jpg');
    const handler = () => {};
    setMediaAction('pause', handler);
    expect(session.setActionHandler).toHaveBeenCalledWith('pause', handler);
    setMediaPlaying(true);
    expect(session.playbackState).toBe('playing');
    clearMediaInfo();
    expect(session.metadata).toBe(null);
    expect(calls).toEqual([]);
    delete navigator.mediaSession;
  });
});

describe('lock-screen controls in the Android app', () => {
  test('go to the plugin, and a pause counts only after 2 seconds', async () => {
    vi.useFakeTimers();
    globalThis.Capacitor = { isNativePlatform: () => true, getPlatform: () => 'android' };
    setMediaInfo({ title: 'Evolution Debate', artist: 'JimBob', artwork: '/replay/4/thumb.jpg' });
    setMediaPlaying(true);
    await vi.runAllTimersAsync();
    expect(calls).toContainEqual([
      'setMetadata',
      {
        title: 'Evolution Debate',
        artist: 'JimBob',
        artwork: [
          { src: 'https://madebyjimbob.app/replay/4/thumb.jpg', sizes: '640x360', type: 'image/jpeg' },
        ],
      },
    ]);
    expect(calls).toContainEqual(['setPlaybackState', { playbackState: 'playing' }]);

    // The screen locks: the video pauses and its sound starts right away. Android never hears "paused".
    calls.length = 0;
    setMediaPlaying(false);
    await vi.advanceTimersByTimeAsync(300);
    setMediaPlaying(true);
    await vi.advanceTimersByTimeAsync(3000);
    expect(calls.filter(([name]) => name === 'setPlaybackState')).toEqual([
      ['setPlaybackState', { playbackState: 'playing' }],
    ]);

    // A real pause.
    calls.length = 0;
    setMediaPlaying(false);
    await vi.advanceTimersByTimeAsync(1900);
    expect(calls).toEqual([]);
    await vi.advanceTimersByTimeAsync(200);
    expect(calls).toEqual([['setPlaybackState', { playbackState: 'paused' }]]);
  });

  test('buttons and position go to the plugin too', async () => {
    globalThis.Capacitor = { isNativePlatform: () => true, getPlatform: () => 'android' };
    const handler = () => {};
    setMediaAction('nexttrack', handler);
    setMediaPosition({ duration: 600, currentTime: 42, playbackRate: 1.5 });
    setMediaPosition({ duration: Infinity, currentTime: 5 }); // a live stream: left out
    await flush();
    await flush();
    expect(calls).toEqual([
      ['setActionHandler', { action: 'nexttrack' }, handler],
      ['setPositionState', { duration: 600, position: 42, playbackRate: 1.5 }],
    ]);
  });
});
