import Hls from 'hls.js';

// Plays a live HLS stream (ADR-004) and keeps trying: right after OBS connects, the site can say "live" a few
// seconds before the first video reaches R2, and a stream can hiccup mid-show. Returns a cleanup function.
export function attachLive(el, src, onReady) {
  if (!Hls.isSupported()) {
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
