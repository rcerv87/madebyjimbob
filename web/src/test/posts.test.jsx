import { describe, test, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import Posts, { PostCard } from '../pages/Posts.jsx';

const membersPost = {
  id: 'm',
  kind: 'members',
  when: 'Members only',
  tier: 'Plus',
  text: 'Secret time-lapse',
  images: [{ src: '/x.jpg', alt: 'x' }],
};

describe('Posts preview', () => {
  test('every example is labeled and the stream post links to the real video', async () => {
    mockApi({
      '/videos': {
        videos: [{ id: '4', title: 'Evolution Debate', durationS: 12302, chatCount: 6498, thumbnail: null }],
      },
      '/shop': { products: [] },
    });
    render(
      <MemoryRouter>
        <Posts session={{ user: null, requireSignIn: () => {} }} />
      </MemoryRouter>,
    );
    expect(screen.getByText(/example posts in JimBob’s style/)).toBeTruthy();
    expect(screen.getAllByText('Example').length).toBeGreaterThanOrEqual(5);
    expect((await screen.findByText('Evolution Debate')).closest('a').getAttribute('href')).toBe('/watch/4');
  });

  test('members-only posts are locked below the tier and open at it', () => {
    const { rerender } = render(<PostCard p={membersPost} userTier="free" requireSignIn={() => {}} />);
    expect(screen.getByText('Plus members only')).toBeTruthy();
    expect(screen.queryByText('Secret time-lapse')).toBeNull();
    rerender(<PostCard p={membersPost} userTier="plus" />);
    expect(screen.getByText('Secret time-lapse')).toBeTruthy();
  });

  test('the preview poll marks your pick', () => {
    render(
      <PostCard
        p={{ id: 'p', kind: 'poll', when: 'Poll', text: 'Who?', options: ['A', 'B'] }}
        userTier="free"
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'B' }));
    expect(screen.getByRole('button', { name: /B/ }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByText('Your pick')).toBeTruthy();
  });
});
