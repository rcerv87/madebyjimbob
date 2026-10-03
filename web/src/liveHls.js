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
  const cleanup = () => {
    stopped = true;
    clearTimeout(timer);
    hls?.destroy();
  };
  // Short rewinds stay on the live feed, inside what's already downloaded: step back `seconds` from where it's playing
  // (false if that isn't buffered), with catching up to live switched off until toLive().
  cleanup.control = {
    seekBy(seconds) {
      const to = el.currentTime - seconds;
      const b = el.buffered;
      const sk = el.seekable;
      const earliest = Math.min(b.length ? b.start(0) : Infinity, sk.length ? sk.start(0) : Infinity);
      // Back as far as what's buffered or still in the live window; forward only up to what's buffered.
      const latest = b.length ? b.end(b.length - 1) - 0.5 : el.currentTime;
      if (!Number.isFinite(earliest) || to < earliest || to > latest) return false;
      if (hls)
        Object.assign(hls.config, { liveMaxLatencyDurationCount: Infinity, maxLiveSyncPlaybackRate: 1 });
      el.currentTime = to;
      return true;
    },
    toLive() {
      if (!hls) return;
      Object.assign(hls.config, { liveMaxLatencyDurationCount: 4, maxLiveSyncPlaybackRate: 1.1 });
      if (hls.liveSyncPosition) el.currentTime = hls.liveSyncPosition;
    },
  };
  return cleanup;
}

// Loads playlists with an end marker added, so a recording still in progress plays as a finished video.
class SnapshotLoader extends Hls.DefaultConfig.loader {
  load(context, config, callbacks) {
    const onSuccess = callbacks.onSuccess;
    super.load(context, config, {
      ...callbacks,
      onSuccess: (response, stats, ctx, networkDetails) => {
        if (
          typeof response.data === 'string' &&
          response.data.includes('#EXTINF') &&
          !response.data.includes('#EXT-X-ENDLIST')
        )
          response.data = `${response.data.trimEnd()}
#EXT-X-ENDLIST
`;
        onSuccess(response, stats, ctx, networkDetails);
      },
    });
  }
}

// Plays the whole stream so far from the recording (MBJ-310), starting at `startAt` seconds from the beginning. The
// recording's playlist grows while live, so hls.js treats it as live, but nothing pulls the viewer to the live edge.
export function attachRecording(el, url, startAt, onReady, onEnd, { follow = false } = {}) {
  // Near live: follow the recording's growing end like a live stream (no snapshot, no start position).
  if (follow && !native(el)) {
    const live = new Hls({ liveSyncDurationCount: 2 });
    live.on(Hls.Events.MANIFEST_PARSED, onReady);
    live.on(Hls.Events.ERROR, (_e, data) => {
      if (data.fatal && data.type === Hls.ErrorTypes.MEDIA_ERROR) live.recoverMediaError();
      else if (data.fatal) live.startLoad();
    });
    live.loadSource(url);
    live.attachMedia(el);
    return () => live.destroy();
  }
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
  // Played as a finished video (what's recorded so far): a growing playlist makes hls.js treat it as live and line it
  // up by guesswork, which put playback ~45 s away from where the timeline said. With an end added, every position
  // maps exactly. onEnd fires when playback reaches the end of that snapshot, so the caller can reload or go live.
  const hls = new Hls({ startPosition: startAt, pLoader: SnapshotLoader });
  hls.on(Hls.Events.MANIFEST_PARSED, onReady);
  const ended = () => onEnd?.(el.currentTime);
  el.addEventListener('ended', ended);
  hls.on(Hls.Events.ERROR, (_e, data) => {
    if (data.fatal && data.type === Hls.ErrorTypes.MEDIA_ERROR) hls.recoverMediaError();
    else if (data.fatal) hls.startLoad();
  });
  hls.loadSource(url);
  hls.attachMedia(el);
  return () => {
    el.removeEventListener('ended', ended);
    hls.destroy();
  };
}
