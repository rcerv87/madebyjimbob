import { describe, test, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import StudioLinks from '../components/StudioLinks.jsx';

const links = [
  {
    id: 4,
    username: 'rumble_fan',
    platform: 'rumble',
    status: 'pending',
    handle: 'RumbleFan',
    createdAt: new Date(),
  },
  {
    id: 5,
    username: 'yt_asker',
    platform: 'youtube',
    status: 'pending',
    handle: '@AskerYT',
    messagesSeen: 12,
    createdAt: new Date(),
  },
  {
    id: 2,
    username: 'yt_fan',
    platform: 'youtube',
    status: 'verified',
    handle: '@FanOnYT',
    verifiedBy: 'admin',
    verifiedAt: new Date(),
  },
];

describe('Studio linked accounts', () => {
  test('confirms YouTube and Rumble requests and lists linked accounts', async () => {
    globalThis.fetch = vi.fn(
      async (url) =>
        new Response(JSON.stringify(String(url).endsWith('/studio/links') ? { links } : { ok: true }), {
          status: 200,
        }),
    );
    render(<StudioLinks />);
    expect(await screen.findByText(/says they’re RumbleFan on Rumble/)).toBeTruthy();
    expect(screen.getByText(/says they’re @AskerYT on YouTube/)).toBeTruthy();
    expect(screen.getByText('12 messages from that handle so far')).toBeTruthy();
    expect(screen.getByText('@FanOnYT on YouTube')).toBeTruthy();
    fireEvent.click(screen.getAllByRole('button', { name: 'Confirm' })[1]);
    await waitFor(() =>
      expect(
        globalThis.fetch.mock.calls.some(
          ([url, opts]) => String(url) === '/api/studio/links/5/approve' && opts?.method === 'POST',
        ),
      ).toBe(true),
    );
  });
});
