import { describe, test, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import ChatPanel from '../components/ChatPanel.jsx';
import NameCard from '../components/NameCard.jsx';
import StudioReports from '../components/StudioReports.jsx';

function fakeApi(routes) {
  globalThis.fetch = vi.fn(async (url, opts = {}) => {
    const path = String(url)
      .replace(/^\/api/, '')
      .split('?')[0];
    const hit = routes[`${opts.method || 'GET'} ${path}`] || routes[path] || [404, { error: 'Not mocked' }];
    return new Response(JSON.stringify(hit[1]), { status: hit[0] });
  });
  return (method, path) =>
    globalThis.fetch.mock.calls
      .filter(
        ([url, o = {}]) => String(url).split('?')[0] === `/api${path}` && (o.method || 'GET') === method,
      )
      .map(([, o]) => (o.body ? JSON.parse(o.body) : null));
}

const msg = (id, body, over = {}) => ({
  id: String(id),
  source: 'native',
  kind: 'text',
  author: over.profile || 'Viewer',
  body,
  mentions: [],
  offsetMs: 0,
  ...over,
});

describe('blocked and muted members', () => {
  test('their chat messages don’t show; everyone else’s do', async () => {
    fakeApi({
      '/videos/7/chat': [
        200,
        {
          messages: [
            msg(1, 'from a pest', { profile: 'Pest' }),
            msg(2, 'from a friend', { profile: 'Friend' }),
          ],
        },
      ],
      '/videos/7/comments': [200, { comments: [] }],
    });
    const user = { id: 1, username: 'Me', hidden: [{ username: 'pest', kind: 'mute' }] };
    render(
      <MemoryRouter>
        <ChatPanel
          videoId="7"
          timeMs={60_000}
          getTimeMs={() => 60_000}
          session={{ user, requireSignIn: () => {} }}
        />
      </MemoryRouter>,
    );
    expect(await screen.findByText('from a friend')).toBeTruthy();
    expect(screen.queryByText('from a pest')).toBeNull();
  });

  test('name cards offer Mute, Block, and Report… to signed-in viewers, never on yourself', async () => {
    const sent = fakeApi({
      'PUT /account/blocks/Pest': [200, { hidden: [{ username: 'Pest', kind: 'block' }] }],
      'POST /reports': [200, { ok: true, id: 1 }],
    });
    const onChanged = vi.fn();
    const { rerender } = render(
      <MemoryRouter>
        <NameCard
          name="Pest"
          profile="Pest"
          moderation={{ me: 'Me', onChanged }}
          about={{ chatMessageId: '9' }}
        />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Pest' }));
    fireEvent.click(screen.getByRole('button', { name: 'Block' }));
    expect(await screen.findByText(/Blocked Pest/)).toBeTruthy();
    expect(sent('PUT', '/account/blocks/Pest')).toEqual([{ kind: 'block' }]);
    expect(onChanged).toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Report…' }));
    fireEvent.change(screen.getByLabelText('What’s wrong?'), { target: { value: 'spam' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send report' }));
    expect(await screen.findByText(/The moderators will look at it/)).toBeTruthy();
    expect(sent('POST', '/reports')).toEqual([{ username: 'Pest', chatMessageId: '9', reason: 'spam' }]);

    rerender(
      <MemoryRouter>
        <NameCard name="Me" profile="Me" moderation={{ me: 'Me', onChanged }} />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Me' }));
    expect(screen.queryByRole('button', { name: 'Block' })).toBeNull();
  });
});

describe('Studio → Reports', () => {
  test('lists open reports with what was said and marks them handled', async () => {
    const sent = fakeApi({
      '/studio/reports': [
        200,
        {
          reports: [
            {
              id: 4,
              reason: 'spam',
              target: 'Pest',
              reporter: 'Me',
              excerpt: 'buy followers',
              videoId: 2,
              offsetMs: 61_000,
              chatMessageId: 9,
              reportsOnMember: 3,
              createdAt: new Date(),
            },
          ],
        },
      ],
      'POST /studio/reports/4': [200, { ok: true }],
    });
    render(
      <MemoryRouter>
        <StudioReports />
      </MemoryRouter>,
    );
    expect(await screen.findByText('“buy followers”')).toBeTruthy();
    expect(screen.getByText(/3 reports on this member/)).toBeTruthy();
    expect(screen.getByRole('link', { name: 'See it in the video' }).getAttribute('href')).toBe(
      '/watch/2?t=61&chat=all',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Handled' }));
    await waitFor(() => expect(sent('POST', '/studio/reports/4')).toEqual([{ status: 'resolved' }]));
  });
});
