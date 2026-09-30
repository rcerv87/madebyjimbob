import { describe, test, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import Player from '../components/Player.jsx';

// jsdom has no Media Source Extensions, so Player takes the native-HLS path; pretend it's supported.
const proto = window.HTMLMediaElement.prototype;
const original = { canPlayType: proto.canPlayType, play: proto.play };
afterEach(() => Object.assign(proto, original));

async function renderReady(play) {
  proto.canPlayType = () => 'maybe';
  proto.play = play;
  render(<Player src="https://x/video.m3u8" title="Test" />);
  const video = document.querySelector('video');
  await act(async () => {
    video.dispatchEvent(new Event('loadedmetadata'));
  });
  return video;
}

describe('Player autoplay', () => {
  test('plays with sound when the browser allows it', async () => {
    const play = vi.fn(() => Promise.resolve());
    const video = await renderReady(play);
    expect(play).toHaveBeenCalledTimes(1);
    expect(video.muted).toBe(false);
    expect(screen.queryByRole('button', { name: 'Play' })).toBeNull();
  });

  test('never starts muted: when autoplay is blocked it waits with a Play button', async () => {
    const blocked = Object.assign(new Error('blocked'), { name: 'NotAllowedError' });
    const play = vi.fn().mockRejectedValueOnce(blocked).mockResolvedValue();
    const video = await renderReady(play);
    expect(play).toHaveBeenCalledTimes(1);
    expect(video.muted).toBe(false);

    fireEvent.click(screen.getByRole('button', { name: 'Play' }));
    expect(play).toHaveBeenCalledTimes(2);
    expect(video.muted).toBe(false);
    expect(screen.queryByRole('button', { name: 'Play' })).toBeNull();
  });

  test('shows a message when the browser cannot play HLS at all', () => {
    proto.canPlayType = () => '';
    render(<Player src="https://x/video.m3u8" title="Test" />);
    expect(screen.getByRole('alert').textContent).toMatch(/can’t play this video/);
  });
});

describe('Player on a locked phone', () => {
  const master = '#EXTM3U\n#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="a",URI="audio.m3u8"\n';

  function setHidden(hidden) {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
    document.dispatchEvent(new Event('visibilitychange'));
  }

  afterEach(() => {
    delete document.hidden;
    vi.restoreAllMocks();
  });

  async function playOn(userAgent) {
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(userAgent);
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({ text: () => Promise.resolve(master) });
    const video = await renderReady(vi.fn(() => Promise.resolve()));
    Object.defineProperty(video, 'paused', { configurable: true, get: () => false });
    return video;
  }

  test('keeps the sound going as audio when the phone locks, and shows the video again on unlock', async () => {
    const video = await playOn('Mozilla/5.0 (Linux; Android 14; Pixel 8) Mobile');
    await act(async () => setHidden(true));
    const audio = document.querySelector('audio');
    expect(audio.src).toBe('https://x/audio.m3u8');
    expect(screen.getByText('Listening')).toBeTruthy();

    await act(async () => setHidden(false));
    expect(screen.queryByText('Listening')).toBeNull();
    expect(video.controls).toBe(true);
  });

  test('desktop keeps playing the video in a background tab', async () => {
    await playOn('Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/140');
    await act(async () => setHidden(true));
    expect(screen.queryByText('Listening')).toBeNull();
  });
});
