import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';

const listeners = {};
const app = {
  addListener: vi.fn(async (event, fn) => {
    listeners[event] = fn;
    return { remove: () => delete listeners[event] };
  }),
  getLaunchUrl: vi.fn(async () => ({ url: 'https://madebyjimbob.app/watch/7?t=90' })),
  minimizeApp: vi.fn(),
};
const share = { share: vi.fn(async () => ({})) };
vi.mock('@capacitor/app', () => ({ App: app }));
vi.mock('@capacitor/share', () => ({ Share: share }));

const { appLinkPath, onAppLink, onBackButton, shareSheet, canShareSheet } = await import('../native.js');

beforeEach(() => {
  globalThis.Capacitor = { isNativePlatform: () => true, getPlatform: () => 'android' };
});
afterEach(() => {
  delete globalThis.Capacitor;
  document.body.innerHTML = '';
  window.history.replaceState(null, '', '/');
  vi.clearAllMocks();
});

describe('links that open the app', () => {
  test('only the site’s own links become pages in the app', () => {
    expect(appLinkPath('https://madebyjimbob.app/watch/14?t=90')).toBe('/watch/14?t=90');
    expect(appLinkPath('https://www.madebyjimbob.app/@jimbob')).toBe('/@jimbob');
    expect(appLinkPath('https://madebyjimbob.com/live')).toBe('/live');
    expect(appLinkPath('https://evil.example/watch/1')).toBe(null);
    expect(appLinkPath('not a link')).toBe(null);
  });

  test('the link the app started from is shown once; links while it’s open are shown too', async () => {
    const go = vi.fn();
    await onAppLink(go);
    expect(go).toHaveBeenCalledWith('/watch/7?t=90');
    await onAppLink(go); // the page re-renders: the starting link isn't followed again
    expect(go).toHaveBeenCalledTimes(1);
    listeners.appUrlOpen({ url: 'https://madebyjimbob.app/playlist/3' });
    listeners.appUrlOpen({ url: 'https://evil.example/playlist/3' });
    expect(go.mock.calls.map(([p]) => p)).toEqual(['/watch/7?t=90', '/playlist/3']);
  });
});

describe('the Android back button', () => {
  test('closes what’s open first', async () => {
    const closed = vi.fn();
    const backdrop = document.createElement('div');
    backdrop.className = 'dialog-backdrop';
    backdrop.addEventListener('click', closed);
    document.body.appendChild(backdrop);
    await onBackButton(vi.fn());
    listeners.backButton({ canGoBack: true });
    expect(closed).toHaveBeenCalled();
    expect(app.minimizeApp).not.toHaveBeenCalled();
  });

  test('goes back a page, or home, and from home leaves the app', async () => {
    const home = vi.fn();
    const back = vi.spyOn(window.history, 'back').mockImplementation(() => {});
    await onBackButton(home);
    // React Router's history entries carry their position (idx).
    window.history.replaceState({ idx: 2 }, '', '/watch/14');
    listeners.backButton({});
    expect(back).toHaveBeenCalledTimes(1);
    window.history.replaceState({ idx: 0 }, '', '/watch/14'); // opened straight from a link
    listeners.backButton({});
    expect(home).toHaveBeenCalledTimes(1);
    window.history.replaceState({ idx: 3 }, '', '/');
    listeners.backButton({});
    expect(app.minimizeApp).toHaveBeenCalledTimes(1);
    back.mockRestore();
  });
});

describe('the share sheet', () => {
  test('is the phone’s own in the app', async () => {
    expect(canShareSheet()).toBe(true);
    await shareSheet({ title: 'Evolution Debate', url: 'https://madebyjimbob.app/watch/4' });
    expect(share.share).toHaveBeenCalledWith({
      title: 'Evolution Debate',
      url: 'https://madebyjimbob.app/watch/4',
      dialogTitle: 'Share',
    });
  });

  test('on the website, only where the browser has one', () => {
    delete globalThis.Capacitor;
    const had = navigator.share;
    delete navigator.share;
    expect(canShareSheet()).toBe(false);
    navigator.share = had;
  });
});
