import { describe, test, expect, vi, afterEach } from 'vitest';
import { render, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

// hls.js (~580 KB) must load only where it's used: never on iPhone or Safari (native HLS), and only once a player has
// a video elsewhere. A stand-in records whether it was loaded and what the player did with it.
const state = vi.hoisted(() => ({ imported: 0, instances: [] }));
vi.mock('hls.js', () => {
  state.imported += 1;
  class FakeHls {
    static Events = { ERROR: 'error', MANIFEST_PARSED: 'parsed' };
    static ErrorTypes = { NETWORK_ERROR: 'net', MEDIA_ERROR: 'media' };
    static DefaultConfig = { loader: class {} };
    constructor(config) {
      this.config = config;
      this.calls = [];
      state.instances.push(this);
    }
    on(event) {
      this.calls.push(['on', event]);
    }
    loadSource(url) {
      this.calls.push(['loadSource', url]);
    }
    attachMedia(el) {
      this.calls.push(['attachMedia', el.tagName]);
    }
    destroy() {
      this.calls.push(['destroy']);
    }
  }
  return { default: FakeHls };
});

const proto = window.HTMLMediaElement.prototype;
const original = { canPlayType: proto.canPlayType };
const flush = () => act(() => new Promise((r) => setTimeout(r, 0)));
afterEach(() => {
  Object.assign(proto, original);
  delete globalThis.MediaSource;
  delete globalThis.SourceBuffer;
  state.instances.length = 0;
  vi.restoreAllMocks();
});
// What Chrome, Edge and Firefox have: Media Source Extensions that play H.264 + AAC.
const withMse = () => {
  globalThis.MediaSource = { isTypeSupported: (t) => t.includes('avc1') || t.includes('mp4a') };
  globalThis.SourceBuffer = class {
    appendBuffer() {}
    remove() {}
  };
};

describe('the video library loads only when it’s used', () => {
  test('the support check matches hls.js’s without loading it', async () => {
    const { mseSupported } = await import('../hlsLoader.js');
    expect(mseSupported()).toBe(false);
    withMse();
    expect(mseSupported()).toBe(true);
    globalThis.SourceBuffer = class {};
    expect(mseSupported()).toBe(false);
    expect(state.imported).toBe(0);
  });

  test('a browser that plays HLS itself (no MSE) never loads it', async () => {
    proto.canPlayType = () => 'maybe';
    const { default: Player } = await import('../components/Player.jsx');
    render(<Player src="https://x/video.m3u8" title="Test" />);
    await flush();
    expect(document.querySelector('video').src).toBe('https://x/video.m3u8');
    expect(state.instances).toEqual([]);
    expect(state.imported).toBe(0); // the file itself was never fetched
  });

  test('Chrome-like browsers load it as soon as the player has a video, attach it, and clean up', async () => {
    proto.canPlayType = () => '';
    withMse();
    const { default: Player } = await import('../components/Player.jsx');
    const view = render(<Player src="https://x/video.m3u8" title="Test" />);
    await flush();
    expect(state.instances).toHaveLength(1);
    const hls = state.instances[0];
    expect(hls.calls).toContainEqual(['loadSource', 'https://x/video.m3u8']);
    expect(hls.calls).toContainEqual(['attachMedia', 'VIDEO']);
    view.unmount();
    expect(hls.calls.at(-1)).toEqual(['destroy']);
  });

  test('leaving before it has loaded never starts a player', async () => {
    proto.canPlayType = () => '';
    withMse();
    const { default: Player } = await import('../components/Player.jsx');
    const view = render(<Player src="https://x/other.m3u8" title="Test" />);
    view.unmount();
    await flush();
    expect(state.instances).toEqual([]);
  });

  test('an iPhone uses its own player even where MSE exists', async () => {
    vi.resetModules();
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(
      'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148',
    );
    proto.canPlayType = () => 'maybe';
    withMse();
    const { default: Player } = await import('../components/Player.jsx');
    render(<Player src="https://x/phone.m3u8" title="Test" />);
    await flush();
    expect(document.querySelector('video').src).toBe('https://x/phone.m3u8');
    expect(state.instances).toEqual([]);
  });
});

describe('the live banner asks only while it can be seen', () => {
  test('every 30 s while visible; not while hidden; right away on return; never two at once', async () => {
    vi.useFakeTimers();
    let visibility = 'visible';
    vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility);
    const asked = [];
    let answer = null;
    globalThis.fetch = vi.fn((url) => {
      asked.push(String(url));
      return new Promise((resolve) => {
        answer = () => resolve(new Response(JSON.stringify({ online: true }), { status: 200 }));
      });
    });
    const { default: LiveBanner } = await import('../components/LiveBanner.jsx');
    render(
      <MemoryRouter>
        <LiveBanner />
      </MemoryRouter>,
    );
    expect(asked).toHaveLength(1);
    // Still waiting on that answer: a return to the page doesn't ask again.
    document.dispatchEvent(new Event('visibilitychange'));
    expect(asked).toHaveLength(1);
    await act(async () => answer());
    await act(async () => vi.advanceTimersByTimeAsync(30_000));
    expect(asked).toHaveLength(2);
    await act(async () => answer());

    visibility = 'hidden';
    document.dispatchEvent(new Event('visibilitychange'));
    await act(async () => vi.advanceTimersByTimeAsync(120_000));
    expect(asked).toHaveLength(2);

    visibility = 'visible';
    document.dispatchEvent(new Event('visibilitychange'));
    expect(asked).toHaveLength(3);
    expect(asked.every((u) => u.endsWith('/api/live'))).toBe(true);
    vi.useRealTimers();
  });
});
