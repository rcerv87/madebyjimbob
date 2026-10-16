import { describe, test, expect, vi, afterEach } from 'vitest';
import { api } from '../api.js';
import {
  apiUrl,
  siteUrl,
  mediaUrl,
  socketUrl,
  authHeaders,
  socketAuth,
  appToken,
  isNativeApp,
} from '../native.js';
import { isStandalone } from '../device.js';

// What the phone apps put on window before the page loads (Capacitor).
const asApp = (platform = 'android') => {
  globalThis.Capacitor = { isNativePlatform: () => true, getPlatform: () => platform };
};
afterEach(() => {
  delete globalThis.Capacitor;
  localStorage.clear();
});

function fakeFetch(headers = {}) {
  const calls = [];
  globalThis.fetch = vi.fn(async (url, init) => {
    calls.push([String(url), init.headers]);
    return new Response(JSON.stringify({ ok: true }), { status: 200, headers });
  });
  return calls;
}

describe('the website', () => {
  test('calls its own address with the cookie, and never keeps a token', async () => {
    expect(isNativeApp()).toBe(false);
    expect(apiUrl('/videos')).toBe('/api/videos');
    expect(siteUrl('/watch/4')).toBe(`${location.origin}/watch/4`);
    expect(mediaUrl('/live/hls/stream.m3u8')).toBe('/live/hls/stream.m3u8');
    expect(socketUrl()).toBe(`ws://${location.host}/ws`);
    const calls = fakeFetch({ 'set-auth-token': 'abc' });
    await api('/auth/sign-in/username', { method: 'POST', body: {} });
    await api('/me');
    expect(appToken()).toBe(null);
    expect(calls[1][1].Authorization).toBeUndefined();
  });
});

describe('inside the phone apps', () => {
  test('call the live site, and keep and send the sign-in token', async () => {
    asApp();
    expect(apiUrl('/videos')).toBe('https://madebyjimbob.app/api/videos');
    expect(siteUrl('/watch/4?t=90')).toBe('https://madebyjimbob.app/watch/4?t=90');
    expect(socketUrl()).toBe('wss://madebyjimbob.app/ws');
    expect(mediaUrl('/live/hls/stream.m3u8')).toBe('https://madebyjimbob.app/live/hls/stream.m3u8');
    expect(mediaUrl('https://cdn.example/v.m3u8')).toBe('https://cdn.example/v.m3u8');
    expect(mediaUrl(null)).toBe(null);
    expect(authHeaders()).toEqual({});

    const calls = fakeFetch({ 'set-auth-token': 'tok-123' });
    await api('/auth/sign-in/username', { method: 'POST', body: {} });
    expect(appToken()).toBe('tok-123');
    await api('/me');
    expect(calls[1][0]).toBe('https://madebyjimbob.app/api/me');
    expect(calls[1][1].Authorization).toBe('Bearer tok-123');
    expect(socketAuth()).toEqual({ token: 'tok-123' });
  });

  test('count as installed, so the site never asks to be added to the Home Screen', () => {
    asApp('ios');
    expect(isStandalone()).toBe(true);
  });
});
