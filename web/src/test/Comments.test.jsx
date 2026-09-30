import { describe, test, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import Comments from '../components/Comments.jsx';

const comment = (id, over = {}) => ({
  id: String(id),
  parentId: null,
  source: 'youtube',
  author: '@Viewer',
  authorPhoto: null,
  isCreator: false,
  body: `comment ${id}`,
  likes: 0,
  pinned: false,
  postedAt: new Date(Date.now() - 3 * 3600_000).toISOString(),
  replies: [],
  ...over,
});

const signedIn = { user: { username: 'ruben' }, requireSignIn: () => {} };
const signedOut = { user: null, requireSignIn: vi.fn() };

describe('Comments', () => {
  test('shows the count, pinned and creator markers, likes, and collapsed replies', async () => {
    mockApi({
      '/videos/4/comments': {
        total: 3,
        nextOffset: null,
        comments: [
          comment(1, {
            body: 'Great debate\nsecond line',
            likes: 1200,
            pinned: true,
            replies: [
              comment(2, { parentId: '1', author: '@MadebyJimbob', isCreator: true, body: 'thanks' }),
            ],
          }),
          comment(3, { source: 'native', author: 'ruben', body: 'from the site' }),
        ],
      },
    });
    render(<Comments videoId="4" session={signedOut} />);
    expect(await screen.findByText('3 comments')).toBeTruthy();
    expect(screen.getByText('Pinned by JimBob')).toBeTruthy();
    expect(screen.getByText('1.2K')).toBeTruthy();
    expect(screen.getAllByText('3 hours ago').length).toBe(2);
    expect(screen.getByText('JB')).toBeTruthy();
    expect(screen.queryByText('thanks')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: '1 reply' }));
    expect(screen.getByText('thanks')).toBeTruthy();
    expect(screen.getByText('Creator')).toBeTruthy();
  });

  test('signed-out viewers are asked to sign in when they try to comment', async () => {
    mockApi({ '/videos/4/comments': { total: 0, nextOffset: null, comments: [] } });
    render(<Comments videoId="4" session={signedOut} />);
    fireEvent.focus(await screen.findByPlaceholderText('Sign in to comment'));
    expect(signedOut.requireSignIn).toHaveBeenCalled();
    expect(screen.getByText(/No comments yet/)).toBeTruthy();
  });

  test('posting adds the comment to the top of the list', async () => {
    mockApi({ '/videos/4/comments': { total: 1, nextOffset: null, comments: [comment(1)] } });
    render(<Comments videoId="4" session={signedIn} />);
    const box = await screen.findByPlaceholderText('Add a comment…');
    fireEvent.focus(box);
    fireEvent.change(box, { target: { value: 'my new comment' } });

    globalThis.fetch = vi.fn(async () =>
      Response.json({ comment: comment(9, { source: 'native', author: 'ruben', body: 'my new comment' }) }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Comment' }));

    await waitFor(() => expect(screen.getByText('2 comments')).toBeTruthy());
    const bodies = [...document.querySelectorAll('.comment-body')].map((p) => p.textContent);
    expect(bodies).toEqual(['my new comment', 'comment 1']);
    const [, init] = fetch.mock.calls[0];
    expect(JSON.parse(init.body)).toEqual({ text: 'my new comment' });
  });

  test('changing the sort reloads newest first', async () => {
    mockApi({ '/videos/4/comments': { total: 0, nextOffset: null, comments: [] } });
    render(<Comments videoId="4" session={signedOut} />);
    fireEvent.change(await screen.findByLabelText('Sort comments'), { target: { value: 'new' } });
    await waitFor(() =>
      expect(fetch.mock.calls.some(([url]) => String(url).includes('sort=new'))).toBe(true),
    );
  });
});
