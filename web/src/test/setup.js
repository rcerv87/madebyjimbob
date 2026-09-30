import { afterEach, vi } from 'vitest';
import { cleanup } from '@testing-library/react';

// jsdom has no WebSocket server to talk to; a silent stand-in keeps ChatPanel happy.
class FakeWebSocket {
  static instances = [];
  constructor(url) {
    this.url = url;
    this.sent = [];
    FakeWebSocket.instances.push(this);
  }
  send(data) {
    this.sent.push(JSON.parse(data));
  }
  close() {}
}
globalThis.WebSocket = FakeWebSocket;
globalThis.FakeWebSocket = FakeWebSocket;

// jsdom doesn't implement media playback.
window.HTMLMediaElement.prototype.play = () => Promise.resolve();
window.HTMLMediaElement.prototype.pause = () => {};
window.HTMLMediaElement.prototype.canPlayType = () => '';

// Route API calls to per-test handlers: mockApi({ '/videos': {...} }).
globalThis.mockApi = (routes) => {
  globalThis.fetch = vi.fn(async (url) => {
    const path = String(url)
      .replace(/^\/api/, '')
      .split('?')[0];
    const body = routes[path];
    if (body === undefined) return new Response(JSON.stringify({ error: 'Not mocked' }), { status: 404 });
    return new Response(JSON.stringify(body), { status: 200 });
  });
};

afterEach(() => {
  cleanup();
  FakeWebSocket.instances = [];
  localStorage.clear();
});
