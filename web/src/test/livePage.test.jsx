import { describe, test, expect, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import Live from '../pages/Live.jsx';

afterEach(() => vi.restoreAllMocks());

describe('/live', () => {
  test('while live with a recording: rewind controls, Listen, and the live chat', async () => {
    globalThis.fetch = vi.fn(async (url) => {
      const u = String(url);
      const body = u.includes('/api/live')
        ? {
            configured: true,
            online: true,
            hls: '/live/hls/stream.m3u8',
            dvr: {
              url: 'https://pub.example/dvr/r1/master.m3u8',
              startedAt: new Date().toISOString(),
              gapS: 0,
              videoId: 9,
            },
          }
        : u.includes('/chat')
          ? { messages: [], comments: [] }
          : '';
      return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status: 200 });
    });
    render(
      <MemoryRouter>
        <Live session={{ user: null, requireSignIn: () => {} }} />
      </MemoryRouter>,
    );
    expect(await screen.findByRole('button', { name: '🎧 Listen' })).toBeTruthy();
    expect(screen.getByLabelText('Rewind the stream')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Back 1 minute' })).toBeTruthy();
    expect(await screen.findByText('Live chat')).toBeTruthy();
  });

  test('when not live, says so', async () => {
    globalThis.fetch = vi.fn(
      async () => new Response(JSON.stringify({ configured: true, online: false }), { status: 200 }),
    );
    render(
      <MemoryRouter>
        <Live session={{ user: null, requireSignIn: () => {} }} />
      </MemoryRouter>,
    );
    expect(await screen.findByText('JimBob isn’t live right now')).toBeTruthy();
  });
});
