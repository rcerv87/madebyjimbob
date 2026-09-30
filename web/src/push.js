// Web Push: phone/desktop notifications even when the site is closed.
// States: unsupported | needs-install (iPhone not added to Home Screen) | unavailable (server not
// configured) | denied | off | on
import { useCallback, useEffect, useState } from 'react';
import { api } from './api.js';

const isIOS = () =>
  /iPhone|iPad|iPod/.test(navigator.userAgent) ||
  (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

export const isStandalone = () =>
  window.matchMedia?.('(display-mode: standalone)').matches || navigator.standalone === true;

const supported = () =>
  typeof window !== 'undefined' &&
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
