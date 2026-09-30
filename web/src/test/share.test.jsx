import { describe, test, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import ShareButton from '../components/ShareButton.jsx';
import NotFound from '../pages/NotFound.jsx';

afterEach(() => {
  delete navigator.share;
});

describe('ShareButton', () => {
  test('copies the plain link and a link at the current moment', async () => {
    const writeText = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    render(<ShareButton title="Evolution Debate" path="/watch/4" getTimeMs={() => 754_000} />);

    fireEvent.click(screen.getByRole('button', { name: 'Share' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Copy link at 12:34' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(`${location.origin}/watch/4?t=754`));
    expect(await screen.findByText('Link at 12:34 copied')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Share' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Copy link' }));
    await waitFor(() => expect(writeText).toHaveBeenLastCalledWith(`${location.origin}/watch/4`));
  });

  test("uses the phone's share sheet when there is one", async () => {
    navigator.share = vi.fn(() => Promise.resolve());
    render(<ShareButton title="Evolution Debate" path="/watch/4" getTimeMs={() => 0} />);
    fireEvent.click(screen.getByRole('button', { name: 'Share' }));
    expect(screen.queryByRole('menuitem', { name: /Copy link at/ })).toBeNull();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Share…' }));
    await waitFor(() =>
      expect(navigator.share).toHaveBeenCalledWith({
        title: 'Evolution Debate',
        url: `${location.origin}/watch/4`,
      }),
    );
  });
});

describe('NotFound', () => {
  test('explains the dead link, links home, and titles the tab', () => {
    render(
      <MemoryRouter>
        <NotFound />
      </MemoryRouter>,
    );
    expect(screen.getByRole('heading', { name: 'Page not found' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Go to videos' }).getAttribute('href')).toBe('/');
    expect(document.title).toBe('Page not found · MADEbyJIMBOB');
  });
});
