import { describe, test, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import LikeButtons from '../components/LikeButtons.jsx';

const signedIn = { user: { username: 'ruben' }, requireSignIn: vi.fn() };

describe('LikeButtons', () => {
  test('liking shows right away and keeps the server count', async () => {
    globalThis.fetch = vi.fn(async () => Response.json({ likes: 13, myVote: 1 }));
    render(<LikeButtons videoId="4" likes={12} myVote={0} session={signedIn} />);
    fireEvent.click(screen.getByRole('button', { name: 'Like (12)' }));
    expect(screen.getByRole('button', { name: 'Like (13)' }).getAttribute('aria-pressed')).toBe('true');
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({ value: 1 });
  });

  test('tapping your vote again clears it; switching to dislike removes the like', async () => {
    globalThis.fetch = vi.fn(async (_url, init) => {
      const { value } = JSON.parse(init.body);
      return Response.json({ likes: value === 1 ? 13 : 12, myVote: value });
    });
    render(<LikeButtons videoId="4" likes={13} myVote={1} session={signedIn} />);
    fireEvent.click(screen.getByRole('button', { name: 'Dislike' }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Dislike' }).getAttribute('aria-pressed')).toBe('true'),
    );
    expect(screen.getByRole('button', { name: 'Like (12)' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Dislike' }));
    await waitFor(() => expect(JSON.parse(fetch.mock.calls[1][1].body)).toEqual({ value: 0 }));
  });

  test('undoes the change and explains when the server refuses', async () => {
    globalThis.fetch = vi.fn(async () =>
      Response.json({ error: 'This video is for members.' }, { status: 403 }),
    );
    render(<LikeButtons videoId="4" likes={5} myVote={0} session={signedIn} />);
    fireEvent.click(screen.getByRole('button', { name: 'Like (5)' }));
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Like (5)' }).getAttribute('aria-pressed')).toBe('false');
  });

  test('signed-out viewers are asked to sign in', () => {
    const session = { user: null, requireSignIn: vi.fn() };
    render(<LikeButtons videoId="4" likes={5} myVote={0} session={session} />);
    fireEvent.click(screen.getByRole('button', { name: 'Like (5)' }));
    expect(session.requireSignIn).toHaveBeenCalled();
  });
});
