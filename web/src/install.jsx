import { useEffect, useState } from 'react';
import { isIOS, isStandalone } from './device.js';

const DISMISS_KEY = 'mbjb_install_hint_dismissed';

export function registerServiceWorker() {
  if (!('serviceWorker' in navigator) || !import.meta.env.PROD) return;
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
}

// Android / desktop Chrome and Edge offer an install prompt the page can trigger from a button.
export function useInstallPrompt() {
  const [prompt, setPrompt] = useState(null);
  useEffect(() => {
    const onPrompt = (e) => {
      e.preventDefault();
      setPrompt(e);
    };
    const onInstalled = () => setPrompt(null);
    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);
  if (!prompt) return null;
  return async () => {
    prompt.prompt();
    await prompt.userChoice.catch(() => {});
    setPrompt(null);
  };
}

export function InstallButton() {
  const install = useInstallPrompt();
  if (!install) return null;
  return (
    <button type="button" className="text-btn install-btn" onClick={install} aria-label="Install app">
      <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
        <path
          d="M12 4v10m0 0-4-4m4 4 4-4M5 19h14"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      <span className="install-label">Install app</span>
    </button>
  );
}

// iPhone Safari has no install prompt; show the two taps once, until dismissed.
export function IosInstallHint() {
  const [show, setShow] = useState(false);
  useEffect(() => {
    let dismissed = false;
    try {
      dismissed = localStorage.getItem(DISMISS_KEY) === '1';
    } catch {
      dismissed = false;
    }
    setShow(isIOS() && !isStandalone() && !dismissed);
  }, []);
  if (!show) return null;
  const dismiss = () => {
    setShow(false);
    try {
      localStorage.setItem(DISMISS_KEY, '1');
    } catch {
      /* shows again next visit */
    }
  };
  return (
    <div className="ios-hint" role="note">
      <img src="/icons/icon-192.png" alt="" width="36" height="36" />
      <p>
        <b>Install JimBob on your iPhone.</b> Tap <b>Share</b>
        <svg viewBox="0 0 24 24" width="16" height="16" aria-label="the Share icon" role="img">
          <path
            d="M12 3v12M8 7l4-4 4 4M6 11H5v10h14V11h-1"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        then <b>Add to Home Screen</b>. You’ll get notifications and full-screen playback.
      </p>
      <button type="button" className="text-btn" aria-label="Dismiss" onClick={dismiss}>
        ×
      </button>
    </div>
  );
}
