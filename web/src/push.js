// Web Push: phone/desktop notifications even when the site is closed. In the phone apps, the phone's own push
// through Firebase instead (MBJ-405).
// States: unsupported | needs-install (iPhone not added to Home Screen) | unavailable (server not
// configured) | denied | off | on
import { useCallback, useEffect, useState } from 'react';
import { api } from './api.js';
import { isIOS, isStandalone } from './device.js';
import { isNativeApp, nativePlatform } from './native.js';

// The apps only use push when they were built with Firebase's settings file (VITE_NATIVE_PUSH=1, set by
// mobile/scripts/build-android.mjs when google-services.json is there): without it, asking Android for a token
// crashes the app.
// Android only for now: on iPhone the plugin hands back an Apple token, which Firebase can't send to as it is.
const appPush = () =>
  isNativeApp() && nativePlatform() === 'android' && import.meta.env.VITE_NATIVE_PUSH === '1';
let pushPlugin;
// In an array: a Capacitor plugin object is "thenable" and must never resolve a promise itself.
const plugin = () =>
  (pushPlugin ||= import('@capacitor/push-notifications').then((m) => [m.PushNotifications]));

// The token this phone registered for the signed-in member (cleared on sign-out).
const DEVICE_KEY = 'mbj_push_device';
function savedDevice() {
  try {
    return localStorage.getItem(DEVICE_KEY);
  } catch {
    return null;
  }
}
function saveDevice(token) {
  try {
    if (token) localStorage.setItem(DEVICE_KEY, token);
    else localStorage.removeItem(DEVICE_KEY);
  } catch {
    // Private storage off: the app asks again next time.
  }
}

// The phone's Firebase token: register() answers through the 'registration' event.
async function phoneToken(p) {
  let answer;
  const got = new Promise((resolve, reject) => (answer = { resolve, reject }));
  const handles = await Promise.all([
    p.addListener('registration', (t) => answer.resolve(t.value)),
    p.addListener('registrationError', (e) => answer.reject(new Error(e?.error || 'the phone said no'))),
  ]);
  const timer = setTimeout(() => answer.reject(new Error('the phone didn’t answer')), 20_000);
  try {
    await p.register();
    return await got;
  } finally {
    clearTimeout(timer);
    handles.forEach((h) => h.remove());
  }
}

async function registerPhone() {
  const [p] = await plugin();
  if (nativePlatform() === 'android') {
    // The channel the server's notifications go to (Android lets members mute it in the app's settings).
    await p
      .createChannel({
        id: 'activity',
        name: 'Replies and mentions',
        description: 'When someone replies to you or mentions you',
        importance: 4,
        visibility: 1,
      })
      .catch(() => {});
  }
  const token = await phoneToken(p);
  await api('/push/device', { method: 'POST', body: { token, platform: nativePlatform() } });
  saveDevice(token);
}

// Signed in on the app with notifications allowed: (re)register this phone for that account. Tokens can change, and
// a phone that signs in to another account moves to it.
export async function refreshAppPush() {
  if (!appPush()) return;
  try {
    const { native } = await api('/push/key');
    if (!native) return;
    const [p] = await plugin();
    if ((await p.checkPermissions()).receive === 'granted') await registerPhone();
  } catch {
    // Tried again next time the app starts.
  }
}

// Signing out: this phone stops getting that account's notifications. Never throws.
export async function forgetAppPush() {
  const token = appPush() && savedDevice();
  if (!token) return;
  saveDevice(null);
  await api('/push/device', { method: 'DELETE', body: { token } }).catch(() => {});
}

// A tapped notification opens its page. Returns a function that stops listening.
export async function onNotificationTap(go) {
  if (!appPush()) return () => {};
  const [p] = await plugin();
  const handle = await p.addListener('pushNotificationActionPerformed', (action) => {
    const url = action?.notification?.data?.url;
    if (typeof url === 'string' && url.startsWith('/')) go(url);
  });
  return () => handle.remove();
}

// Inside the phone apps, notifications come through the phones' own push (MBJ-405), not Web Push.
const supported = () =>
  typeof window !== 'undefined' &&
  !isNativeApp() &&
  'serviceWorker' in navigator &&
  'PushManager' in window &&
  'Notification' in window;

function keyBytes(base64) {
  const padded = (base64 + '='.repeat((4 - (base64.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
}

export function usePush() {
  const [state, setState] = useState('unsupported');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const check = useCallback(async () => {
    if (isNativeApp()) {
      if (!appPush()) return setState('unsupported');
      const { native } = await api('/push/key').catch(() => ({ native: false }));
      if (!native) return setState('unavailable');
      const [p] = await plugin();
      const { receive } = await p.checkPermissions();
      if (receive === 'denied') return setState('denied');
      return setState(receive === 'granted' && savedDevice() ? 'on' : 'off');
    }
    if (!supported()) return setState(isIOS() && !isStandalone() ? 'needs-install' : 'unsupported');
    if (isIOS() && !isStandalone()) return setState('needs-install');
    const { publicKey } = await api('/push/key').catch(() => ({ publicKey: null }));
    if (!publicKey) return setState('unavailable');
    if (Notification.permission === 'denied') return setState('denied');
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    setState(sub && Notification.permission === 'granted' ? 'on' : 'off');
  }, []);

  useEffect(() => {
    check().catch(() => setState('unsupported'));
  }, [check]);

  const enable = async () => {
    setBusy(true);
    setError('');
    try {
      if (isNativeApp()) {
        const [p] = await plugin();
        let { receive } = await p.checkPermissions();
        if (receive !== 'granted') ({ receive } = await p.requestPermissions());
        if (receive !== 'granted') {
          setState(receive === 'denied' ? 'denied' : 'off');
          return;
        }
        await registerPhone();
        setState('on');
        return;
      }
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        setState(permission === 'denied' ? 'denied' : 'off');
        return;
      }
      const { publicKey } = await api('/push/key');
      const reg = await navigator.serviceWorker.ready;
      const sub =
        (await reg.pushManager.getSubscription()) ||
        (await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: keyBytes(publicKey),
        }));
      await api('/push/subscribe', { method: 'POST', body: { subscription: sub.toJSON() } });
      setState('on');
    } catch (err) {
      setError(`Couldn’t turn on notifications: ${err.message}`);
    } finally {
      setBusy(false);
    }
  };

  return { state, busy, error, enable };
}
