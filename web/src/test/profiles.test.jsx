import { describe, test, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import Profile from '../pages/Profile.jsx';
import NameCard from '../components/NameCard.jsx';

function fakeApi(routes) {
  globalThis.fetch = vi.fn(async (url, opts = {}) => {
    const path = String(url)
      .replace(/^\/api/, '')
      .split('?')[0];
    const hit = routes[`${opts.method || 'GET'} ${path}`] ||
      routes[path] || [404, { error: 'No member with that name.' }];
    return new Response(JSON.stringify(hit[1]), { status: hit[0] });
  });
}

const profile = {
  username: 'ProfileFan',
  displayName: 'ProfileFan',
  tier: 'plus',
  joinedAt: '2026-09-01T00:00:00Z',
  links: { youtube: '@FanOnYT' },
  counts: { comments: 1, chat: 1 },
  showsChat: true,
  comments: [
    {
      id: 5,
      videoId: 3,
      videoTitle: 'Big Debate',
      body: 'Great point',
      offsetMs: 65_000,
      postedAt: new Date(),
    },
  ],
  chat: [
    { id: 9, videoId: 3, videoTitle: 'Big Debate', body: 'hello chat', offsetMs: 1000, postedAt: new Date() },
  ],
};

const at = (path) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/:handle" element={<Profile />} />
      </Routes>
    </MemoryRouter>,
  );

describe('profile page', () => {
  test('shows the member, their linked YouTube, and comments that open the video at that moment', async () => {
    fakeApi({ '/profiles/ProfileFan': [200, { profile }] });
    at('/@ProfileFan');
    expect(await screen.findByRole('heading', { name: /ProfileFan/ })).toBeTruthy();
    expect(screen.getByText('Plus')).toBeTruthy();
    expect(screen.getByText('@FanOnYT on YouTube')).toBeTruthy();
    expect(screen.getByRole('link', { name: /Big Debate · 1:05/ }).getAttribute('href')).toBe(
      '/watch/3?comment=5&t=65',
    );
    expect(screen.getByRole('heading', { name: 'Chat' })).toBeTruthy();
  });

  test('unknown members and non-@ paths are “not found”', async () => {
    fakeApi({});
    at('/@nobody');
    expect(await screen.findByText(/not found|can’t find|doesn’t exist/i)).toBeTruthy();
  });
});

describe('name card', () => {
  test('a member’s name opens a card with View profile, Reply, and Mention', () => {
    const onReply = vi.fn();
    const onMention = vi.fn();
    render(
      <MemoryRouter>
        <NameCard
          name="ProfileFan"
          profile="ProfileFan"
          tier="plus"
          platformName="@FanOnYT"
          actions={[
            { label: 'Reply', onClick: onReply },
            { label: 'Mention', onClick: onMention },
          ]}
        />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'ProfileFan' }));
    expect(screen.getByRole('dialog').textContent).toContain('@FanOnYT on YouTube');
    expect(screen.getByRole('link', { name: 'View profile' }).getAttribute('href')).toBe('/@ProfileFan');
    fireEvent.click(screen.getByRole('button', { name: 'Mention' }));
    expect(onMention).toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  test('a YouTube name with no site account just replies', () => {
    const onPlainClick = vi.fn();
    render(<NameCard name="@SomeViewer" profile={null} onPlainClick={onPlainClick} />);
    fireEvent.click(screen.getByRole('button', { name: '@SomeViewer' }));
    expect(onPlainClick).toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

describe('profile sharing in account settings', () => {
  test('saves the chat and search switches', async () => {
    const { default: Account } = await import('../pages/Account.jsx');
    fakeApi({
      '/account/profile': [200, { showChat: false, indexable: false }],
      'PUT /account/profile': [200, { showChat: true, indexable: false }],
      '/account/links': [200, { youtube: null, rumble: null }],
    });
    render(
      <MemoryRouter>
        <Account
          session={{ user: { id: 1, username: 'Fan', email: 'f@x.com', emailVerified: true, tier: 'free' } }}
          onUserChanged={() => {}}
        />
      </MemoryRouter>,
    );
    expect(screen.getByRole('link', { name: 'View your public profile' }).getAttribute('href')).toBe('/@Fan');
    fireEvent.click(await screen.findByLabelText(/Show my chat messages on my profile/));
    await waitFor(() =>
      expect(
        globalThis.fetch.mock.calls.some(
          ([url, o]) =>
            String(url) === '/api/account/profile' && o?.method === 'PUT' && o.body === '{"showChat":true}',
        ),
      ).toBe(true),
    );
  });
});
