// Running inside the phone apps (Capacitor, ADR-014). The same build is the website and the apps: on the website
// every request goes to this same address with the session cookie; inside an app the pages are on the phone, so
// requests go to the live site over the internet and the app signs in with a Bearer token it keeps on the phone.

// Set by the app itself (Capacitor puts it on window before the page loads).
export const isNativeApp = () => Boolean(globalThis.Capacitor?.isNativePlatform?.());
export const nativePlatform = () => (isNativeApp() ? globalThis.Capacitor.getPlatform() : null); // 'ios' | 'android'

// Where the apps reach the site. A test build can point elsewhere (VITE_SITE_URL, e.g. the PC from an emulator).
export const SITE_URL = (import.meta.env.VITE_SITE_URL || 'https://madebyjimbob.app').replace(/\/+$/, '');

// "/api/videos" on the website; "https://madebyjimbob.app/api/videos" in an app.
export const apiUrl = (path) => `${isNativeApp() ? SITE_URL : ''}/api${path}`;

// A page or file on the site, as an address that works outside this screen (sharing, opening in the browser).
export const siteUrl = (path) => `${isNativeApp() ? SITE_URL : location.origin}${path}`;

// A video address from the API: absolute ones stay; ones on the site itself ("/live/hls/…") need the site in an app.
export const mediaUrl = (url) => (url && url.startsWith('/') && isNativeApp() ? `${SITE_URL}${url}` : url);

export function socketUrl() {
  const at = new URL(isNativeApp() ? SITE_URL : location.href);
  return `${at.protocol === 'https:' ? 'wss' : 'ws'}://${at.host}/ws`;
}

// ---------- the app's sign-in token ----------

const TOKEN_KEY = 'mbj_app_token';
export function appToken() {
  if (!isNativeApp()) return null;
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}
export function setAppToken(token) {
  if (!isNativeApp()) return;
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    // Storage refused: the member signs in again next time.
  }
}
// Headers every request from an app carries; nothing on the website (the cookie does it there).
export const authHeaders = () => {
  const token = appToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
};
// For the WebSocket's first message: who this is, in an app.
export const socketAuth = () => {
  const token = appToken();
  return token ? { token } : {};
};

// ---------- leaving the app ----------

// Opens a page outside the app (a checkout, the store, the website) in the phone's browser; on the website it just
// goes there.
export async function openOutside(url) {
  if (!isNativeApp()) {
    window.location.assign(url);
    return;
  }
  const { Browser } = await import('@capacitor/browser');
  await Browser.open({ url });
}

// Runs `fn` whenever the app comes back to the front (to pick up a membership bought in the browser, say).
export async function onAppResume(fn) {
  if (!isNativeApp()) return () => {};
  const { App } = await import('@capacitor/app');
  const handle = await App.addListener('resume', fn);
  return () => handle.remove();
}
