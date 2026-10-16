// Lock-screen and notification controls (MBJ-403). On the website (and in the iPhone app, whose web view has it) this
// is the browser's Media Session API. In the Android app it's the media-session plugin: it shows the controls and
// runs Android's media service while something plays, so the sound keeps going with the screen off and Android
// doesn't close the app in the background.
import { mediaUrl, nativePlatform } from './native.js';

const viaPlugin = () => nativePlatform() === 'android';
const viaBrowser = () => !viaPlugin() && typeof navigator !== 'undefined' && 'mediaSession' in navigator;
export const mediaControlsAvailable = () => viaPlugin() || viaBrowser();

// The plugin is wrapped in an array before it's handed through a promise: a Capacitor plugin answers to any method
// name, `then` included, so a promise would take it for another promise and call the app for "then" instead.
let plugin;
const withPlugin = (fn) => {
  plugin ||= import('@capgo/capacitor-media-session').then((m) => [m.MediaSession]);
  return plugin.then(([p]) => fn(p)).catch(() => {});
};

// What's playing: the title, who, and a picture (the video's thumbnail).
export function setMediaInfo({ title, artist, artwork }) {
  const art = artwork ? [{ src: mediaUrl(artwork), sizes: '640x360', type: 'image/jpeg' }] : [];
  if (viaPlugin()) withPlugin((p) => p.setMetadata({ title, artist, artwork: art }));
  else if (viaBrowser()) navigator.mediaSession.metadata = new MediaMetadata({ title, artist, artwork: art });
}

export function clearMediaInfo() {
  clearTimeout(pauseTimer);
  if (viaPlugin()) withPlugin((p) => p.setPlaybackState({ playbackState: 'none' }));
  else if (viaBrowser()) navigator.mediaSession.metadata = null;
}

// One lock-screen button (play, pause, seekbackward, seekforward, nexttrack, previoustrack); null removes it.
export function setMediaAction(action, handler) {
  if (viaPlugin()) {
    withPlugin((p) => p.setActionHandler({ action }, handler));
    return;
  }
  if (!viaBrowser()) return;
  try {
    navigator.mediaSession.setActionHandler(action, handler);
  } catch {
    // Older browsers throw for actions they don't know (nexttrack, say).
  }
}

// Playing or paused. A pause counts only after 2 seconds: as the screen locks the player swaps the video for its
// sound (a pause, then a play), and Android can't restart the media service from the background if it stopped in
// between.
let pauseTimer;
export function setMediaPlaying(playing) {
  clearTimeout(pauseTimer);
  const report = (state) => {
    if (viaPlugin()) withPlugin((p) => p.setPlaybackState({ playbackState: state }));
    else if (viaBrowser()) navigator.mediaSession.playbackState = state;
  };
  if (playing) report('playing');
  else pauseTimer = setTimeout(() => report('paused'), 2000);
}

// Where playback is, for the progress bar on the lock screen.
export function setMediaPosition(el) {
  if (!el || !Number.isFinite(el.duration) || el.duration <= 0) return;
  const position = {
    duration: el.duration,
    position: Math.min(el.currentTime, el.duration),
    playbackRate: el.playbackRate || 1,
  };
  if (viaPlugin()) withPlugin((p) => p.setPositionState(position));
  else if (viaBrowser()) {
    try {
      navigator.mediaSession.setPositionState?.(position);
    } catch {
      // A live stream's duration can be out of range for the browser.
    }
  }
}
