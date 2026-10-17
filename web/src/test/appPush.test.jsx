import { describe, test, expect, vi, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

// A stand-in for the phone's push plugin. Like a real Capacitor plugin it answers to any name, `then` included.
const calls = [];
const listeners = {};
const phone = { permission: 'prompt' };
const answers = {
  checkPermissions: () => ({ receive: phone.permission }),
  requestPermissions: () => {
    phone.permission = 'granted';
    return { receive: 'granted' };
  },
  addListener: (event, fn) => {
    listeners[event] = fn;
    return { remove: () => delete listeners[event] };
  },
  register: () => setTimeout(() => listeners.registration?.({ value: 'fcm-token-1' }), 0),
};
vi.mock('@capacitor/push-notifications', () => ({
  PushNotifications: new Proxy(
    {},
    {
      get: (_target, name) => {
        if (name === 'then') return (resolve) => resolve('not the plugin');
        return async (...args) => {
          calls.push(name);
          return answers[name]?.(...args);
        };
      },
    },
  ),
}));

const { usePush, onNotificationTap, forgetAppPush, refreshAppPush } = await import('../push.js');

const asApp = () => {
  globalThis.Capacitor = { isNativePlatform: () => true, getPlatform: () => 'android' };
};
function fakeServer({ native = true } = {}) {
  const sent = [];
  globalThis.fetch = vi.fn(async (url, init) => {
    const path = new URL(String(url)).pathname;
    sent.push([init.method || 'GET', path, init.body ? JSON.parse(init.body) : null]);
    const body = path === '/api/push/key' ? { publicKey: null, native } : { ok: true };
    return new Response(JSON.stringify(body), { status: 200 });
  });
  return sent;
}
afterEach(() => {
  delete globalThis.Capacitor;
  vi.unstubAllEnvs();
  localStorage.clear();
  calls.length = 0;
  phone.permission = 'prompt';
});

describe('notifications in the phone apps', () => {
  test('Turn on asks the phone, makes the Android channel, and registers the phone for this account', async () => {
    asApp();
    vi.stubEnv('VITE_NATIVE_PUSH', '1');
    const sent = fakeServer();
    const { result } = renderHook(() => usePush());
    await waitFor(() => expect(result.current.state).toBe('off'));
    await act(() => result.current.enable());
    expect(result.current.state).toBe('on');
    expect(calls).toEqual(expect.arrayContaining(['requestPermissions', 'createChannel', 'register']));
    expect(sent).toContainEqual(['POST', '/api/push/device', { token: 'fcm-token-1', platform: 'android' }]);

    // Signing out forgets the phone, once.
    await forgetAppPush();
    expect(sent).toContainEqual(['DELETE', '/api/push/device', { token: 'fcm-token-1' }]);
    const deletes = () => sent.filter(([m]) => m === 'DELETE').length;
    await forgetAppPush();
    expect(deletes()).toBe(1);
  });

  test('signing in on a phone that allows notifications registers it without asking', async () => {
    asApp();
    vi.stubEnv('VITE_NATIVE_PUSH', '1');
    phone.permission = 'granted';
    const sent = fakeServer();
    await refreshAppPush();
    expect(calls).not.toContain('requestPermissions');
    expect(sent).toContainEqual(['POST', '/api/push/device', { token: 'fcm-token-1', platform: 'android' }]);

    calls.length = 0;
    phone.permission = 'prompt';
    await refreshAppPush();
    expect(calls).not.toContain('register');
  });

  test('a tapped notification opens its page', async () => {
    asApp();
    vi.stubEnv('VITE_NATIVE_PUSH', '1');
    const go = vi.fn();
    const stop = await onNotificationTap(go);
    listeners.pushNotificationActionPerformed({ notification: { data: { url: '/watch/3?t=5&comment=9' } } });
    listeners.pushNotificationActionPerformed({
      notification: { data: { url: 'https://elsewhere.example/' } },
    });
    expect(go.mock.calls).toEqual([['/watch/3?t=5&comment=9']]);
    stop();
    expect(listeners.pushNotificationActionPerformed).toBeUndefined();
  });

  test('blocked in the phone’s settings says so', async () => {
    asApp();
    vi.stubEnv('VITE_NATIVE_PUSH', '1');
    phone.permission = 'denied';
    fakeServer();
    const { result } = renderHook(() => usePush());
    await waitFor(() => expect(result.current.state).toBe('denied'));
  });

  test('stays off (and never touches the plugin) when the app or the server isn’t set up for it', async () => {
    asApp();
    fakeServer();
    const built = renderHook(() => usePush());
    await waitFor(() => expect(built.result.current.state).toBe('unsupported'));
    await refreshAppPush();
    expect(calls).toEqual([]);

    vi.stubEnv('VITE_NATIVE_PUSH', '1');
    fakeServer({ native: false });
    const server = renderHook(() => usePush());
    await waitFor(() => expect(server.result.current.state).toBe('unavailable'));
    await refreshAppPush();
    expect(calls).toEqual([]);
  });
});
