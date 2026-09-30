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
