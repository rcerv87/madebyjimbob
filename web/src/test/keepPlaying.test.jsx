import { describe, test, expect } from 'vitest';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useNavigate, useParams } from 'react-router-dom';
import { useKeepPlaying } from '../keepPlaying.js';

// Mirrors how App renders the watch page in its own spot.
function Shell() {
  const { watchAt, background } = useKeepPlaying();
  const navigate = useNavigate();
  return (
    <>
      {watchAt && (
        <div data-testid="watch-slot" hidden={background}>
          <Routes location={watchAt}>
            <Route path="/watch/:id" element={<FakeWatch />} />
          </Routes>
        </div>
      )}
      <button onClick={() => navigate('/shop')}>Shop</button>
    </>
  );
}

function FakeWatch() {
  const { id } = useParams();
  return <video data-testid="video" data-id={id} />;
}

function openWatch() {
  render(
    <MemoryRouter initialEntries={['/watch/7']}>
      <Shell />
    </MemoryRouter>,
  );
  return screen.getByTestId('video');
}

const pip = (video, type) => act(async () => video.dispatchEvent(new Event(type, { bubbles: true })));

describe('Mini player keeps playing across pages', () => {
  test('without the Mini player, leaving the watch page closes it', () => {
    openWatch();
    fireEvent.click(screen.getByText('Shop'));
    expect(screen.queryByTestId('watch-slot')).toBeNull();
  });

  test('in the Mini player, the same video stays on the page (hidden) while browsing', async () => {
    const video = openWatch();
    await pip(video, 'enterpictureinpicture');
    fireEvent.click(screen.getByText('Shop'));
    expect(screen.getByTestId('video')).toBe(video);
    expect(screen.getByTestId('watch-slot').hidden).toBe(true);
  });

  test('closing the Mini player (video paused) lets the watch page go', async () => {
    const video = openWatch();
    await pip(video, 'enterpictureinpicture');
    fireEvent.click(screen.getByText('Shop'));
    await pip(video, 'leavepictureinpicture');
    await waitFor(() => expect(screen.queryByTestId('watch-slot')).toBeNull());
  });

  test('"Back to tab" (still playing) goes back to the watch page', async () => {
    const video = openWatch();
    await pip(video, 'enterpictureinpicture');
    fireEvent.click(screen.getByText('Shop'));
    Object.defineProperty(video, 'paused', { get: () => false });
    await pip(video, 'leavepictureinpicture');
    await waitFor(() => expect(screen.getByTestId('watch-slot').hidden).toBe(false));
    expect(screen.getByTestId('video')).toBe(video);
  });
});
