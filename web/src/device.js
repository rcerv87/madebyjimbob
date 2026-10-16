import { isNativeApp } from './native.js';

// What the site is running on. One place, so the player, push, and install hints agree.

// iPhone or iPad (iPadOS reports itself as a Mac, but one with a touch screen).
export const isIOS = () =>
  typeof navigator !== 'undefined' &&
  (/iPhone|iPad|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1));

// Opened from the Home Screen as an installed app, or running inside the phone apps (they're installed already).
export const isStandalone = () =>
  isNativeApp() || window.matchMedia?.('(display-mode: standalone)').matches || navigator.standalone === true;
