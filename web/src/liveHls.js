import Hls from 'hls.js';
import { isIOS } from './device.js';

// iPhone/iPad: Safari's own HLS player is the one iOS keeps playing when the phone locks.
const native = (el) => el.canPlayType('application/vnd.apple.mpegurl') && (isIOS() || !Hls.isSupported());

// Plays a live HLS stream (ADR-004) and keeps trying: right after OBS connects, the site can say "live" a few
// seconds before the first video reaches R2, and a stream can hiccup mid-show. Returns a cleanup function.
export function attachLive(el, src, onReady) {
  if (native(el)) {
    el.src = src;
    el.addEventListener('loadedmetadata', onReady, { once: true });
    const retry = () => setTimeout(() => el.isConnected && ((el.src = src), el.load()), 3000);
    el.addEventListener('error', retry);
    return () => {
      el.removeEventListener('error', retry);
      el.removeAttribute('src');
    };
  }
  let hls;
  let timer;
  let stopped = false;
  const start = () => {
    hls = new Hls({ liveSyncDurationCount: 2, liveMaxLatencyDurationCount: 4, maxLiveSyncPlaybackRate: 1.1 });
    hls.on(Hls.Events.MANIFEST_PARSED, onReady);
    hls.on(Hls.Events.ERROR, (_e, data) => {
      if (!data.fatal) return;
      if (data.type === Hls.ErrorTypes.MEDIA_ERROR) return hls.recoverMediaError();
      hls.destroy();
      if (!stopped) timer = setTimeout(start, 3000);
    });
    hls.loadSource(src);
    hls.attachMedia(el);
  };
  start();
  return () => {
    stopped = true;
    clearTimeout(timer);
    hls?.destroy();
  };
}

// Plays the whole stream so far from the recording (MBJ-310), starting at `startAt` seconds from the beginning. The
// recording's playlist grows while live, so hls.js treats it as live, but nothing pulls the viewer to the live edge.
export function attachRecording(el, url, startAt, onReady) {
  if (native(el)) {
    el.src = url;
    const seek = () => {
      el.currentTime = startAt;
      onReady();
    };
    el.addEventListener('loadedmetadata', seek, { once: true });
    return () => {
      el.removeEventListener('loadedmetadata', seek);
      el.removeAttribute('src');
    };
  }
  const hls = new Hls({ startPosition: startAt });
  hls.on(Hls.Events.MANIFEST_PARSED, onReady);
  hls.on(Hls.Events.ERROR, (_e, data) => {
    if (data.fatal && data.type === Hls.ErrorTypes.MEDIA_ERROR) hls.recoverMediaError();
    else if (data.fatal) hls.startLoad();
  });
  hls.loadSource(url);
  hls.attachMedia(el);
  return () => hls.destroy();
}
