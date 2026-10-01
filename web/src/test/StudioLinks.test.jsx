import { describe, test, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import StudioLinks from '../components/StudioLinks.jsx';

describe('Studio linked accounts', () => {
  test('confirms a Rumble name and lists linked accounts', async () => {
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
        id: 2,
        username: 'yt_fan',
        platform: 'youtube',
        status: 'verified',
        handle: '@FanOnYT',
        verifiedBy: 'code',
      },
    ];
    globalThis.fetch = vi.fn(
      async (url, opts = {}) =>
        new Response(JSON.stringify(String(url).endsWith('/studio/links') ? { links } : { ok: true }), {
          status: 200,
        }),
    );
    render(<StudioLinks />);
    expect(await screen.findByText(/says they’re RumbleFan on Rumble/)).toBeTruthy();
    expect(screen.getByText('@FanOnYT on YouTube')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    await waitFor(() =>
      expect(
        globalThis.fetch.mock.calls.some(
          ([url, opts]) => String(url) === '/api/studio/links/4/approve' && opts?.method === 'POST',
        ),
      ).toBe(true),
    );
  });
});
