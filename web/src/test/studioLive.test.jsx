import { describe, test, expect, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import StudioLive from '../components/StudioLive.jsx';

const state = (server, extra = {}) => ({
  configured: true,
  mode: 'hetzner',
  online: false,
  hls: null,
  obs: { server: 'rtmp://5.161.237.192:1935/live', streamKey: 'k' },
  usage: { hours: 1, costUsd: 0.12 },
  limits: { idleMinutes: 30, capHours: 8, hourlyUsd: 0.118 },
  server,
  ...extra,
});
const serve = (body) => {
  globalThis.fetch = vi.fn(async () => new Response(JSON.stringify(body), { status: 200 }));
};
afterEach(() => vi.restoreAllMocks());

describe('Studio → Live: ready-to-stream indicator', () => {
  test('while starting, shows which step it is on', async () => {
    serve(
      state({ status: 'starting', created: true, answering: false, createdAt: new Date().toISOString() }),
    );
    render(<StudioLive />);
    const current = await screen.findByText('Starting the streaming software');
    expect(current.closest('li').className).toBe('current');
    expect(screen.queryByText('Ready to stream')).toBeNull();
  });

  test('once the server is ready, says to start OBS', async () => {
    serve(state({ status: 'ready', created: true, createdAt: new Date().toISOString() }));
    render(<StudioLive />);
    expect(await screen.findByText('Ready to stream')).toBeTruthy();
    expect(screen.getByText('Start streaming in OBS now.')).toBeTruthy();
  });
});
