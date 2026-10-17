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

// ---------- the phone's share sheet ----------

// The phone's own share sheet: Capacitor's in the apps, the browser's (Web Share) on the website where it has one.
export const canShareSheet = () =>
  isNativeApp() || (typeof navigator !== 'undefined' && typeof navigator.share === 'function');
export async function shareSheet({ title, url }) {
  if (isNativeApp()) {
    const { Share } = await import('@capacitor/share');
    await Share.share({ title, url, dialogTitle: 'Share' });
  } else await navigator.share({ title, url });
}

// ---------- links and the back button (MBJ-408) ----------

const SITE_HOSTS = new Set([
  'madebyjimbob.app',
  'www.madebyjimbob.app',
  'madebyjimbob.com',
  'www.madebyjimbob.com',
]);
// "/watch/14?t=90" from a link to the site, or null for anything else.
export function appLinkPath(url) {
  try {
    const u = new URL(url);
    return SITE_HOSTS.has(u.host) || u.origin === new URL(SITE_URL).origin
      ? `${u.pathname}${u.search}${u.hash}`
      : null;
  } catch {
    return null;
  }
}

// A link to the site opened the app (tapped in a message, an email, a notification): `go(path)` shows that page.
// Covers the app starting from the link and the app already open.
let launchLinkUsed = false; // the link the app started from is followed once, not on every re-render
export async function onAppLink(go) {
  if (!isNativeApp()) return () => {};
  const { App } = await import('@capacitor/app');
  if (!launchLinkUsed) {
    launchLinkUsed = true;
    const launch = await App.getLaunchUrl().catch(() => null);
    const first = launch?.url && appLinkPath(launch.url);
    if (first && first !== `${location.pathname}${location.search}`) go(first);
  }
  const handle = await App.addListener('appUrlOpen', ({ url }) => {
    const path = appLinkPath(url);
    if (path) go(path);
  });
  return () => handle.remove();
}

// Something open on top of the page (a dialog, a menu, a name card): closes it and returns true.
function closeWhatsOpen() {
  const backdrop = document.querySelector('.dialog-backdrop');
  if (backdrop) {
    backdrop.click(); // a tap outside the dialog closes it
    return true;
  }
  if (document.querySelector('[role=menu], [role=dialog], .art-viewer')) {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    return true;
  }
  return false;
}

// React Router numbers the app's history entries (history.state.idx): above 0 there's a page in the app to go back
// to. The web view's own canGoBack doesn't count the app's page changes.
const inAppHistory = () => (window.history.state?.idx ?? 0) > 0;

// The Android back button: closes what's open, then goes back a page, then home, and from home leaves the app (it
// keeps playing if something is). `home` shows the home page when there's no page to go back to.
export async function onBackButton(home) {
  if (!isNativeApp()) return () => {};
  const { App } = await import('@capacitor/app');
  const handle = await App.addListener('backButton', () => {
    if (closeWhatsOpen()) return;
    if (location.pathname === '/') App.minimizeApp();
    else if (inAppHistory()) window.history.back();
    else home();
  });
  return () => handle.remove();
}
