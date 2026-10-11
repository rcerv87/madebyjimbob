import { describe, test, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import Studio from '../pages/Studio.jsx';

const overview = {
  totals: { videos: 2, views: 10, chatters: 3, youtubeMsgs: 5, nativeMsgs: 1, paidMsgs: 0 },
  attention: { openReports: 2, pendingLinks: 1, failedImports: 0, queuedImports: 0 },
  members: { total: 12, newThisWeek: 4, paying: 3 },
  videos: [{ id: '1', title: 'Test stream A', views: 10, minTier: 'free', durationS: 60 }],
  topChatters: [{ author: 'Viewer', source: 'youtube', msgs: 5, paid: 0 }],
};

function open(path) {
  const asked = [];
  globalThis.fetch = vi.fn(async (url) => {
    const p = String(url)
      .replace(/^\/api/, '')
      .split('?')[0];
    asked.push(p);
    if (p === '/studio/overview') return Response.json(overview);
    if (p === '/studio/reports') return Response.json({ reports: [] });
    if (p === '/studio/playlists') return Response.json({ playlists: [] });
    return Response.json({});
  });
  render(
    <MemoryRouter initialEntries={[path]}>
      <Studio user={{ id: 1, username: 'jimbob', isAdmin: true }} />
    </MemoryRouter>,
  );
  return asked;
}

describe('Studio tabs', () => {
  test('Overview shows the numbers and what needs attention, without loading the other sections', async () => {
    const asked = open('/studio');
    expect(await screen.findByText('2 reports to look at')).toBeTruthy();
    expect(screen.getByText('1 linked-account request waiting for a yes or no')).toBeTruthy();
    expect(screen.getByText('New this week')).toBeTruthy();
    expect(screen.getByText('Top chatters')).toBeTruthy();
    expect(screen.getByRole('link', { name: /^Reports ?2$/ })).toBeTruthy();
    expect(screen.queryByText('Content')).toBeNull();
    expect(asked).toEqual(['/studio/overview']);
  });

  test('each tab has its own address and shows only its section', async () => {
    open('/studio/videos');
    expect(await screen.findByText('Content')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Videos' }).className).toContain('active');
    expect(screen.queryByText('Needs attention')).toBeNull();
    fireEvent.click(screen.getByRole('link', { name: /^Reports ?2$/ }));
    expect(await screen.findByText('Nothing to look at.')).toBeTruthy();
    expect(screen.queryByText('Content')).toBeNull();
  });
});
