import { useEffect, useRef, useState } from 'react';
import Hls from 'hls.js';

// iPhone/iPad: Safari's built-in HLS player is the one iOS keeps playing on the lock screen.
const SPEEDS = [0.75, 1, 1.25, 1.5, 1.75, 2];

const isAppleMobile =
  typeof navigator !== 'undefined' &&
  (/iPhone|iPad|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1));

// Use Safari's own HLS on Apple mobile; hls.js wherever Media Source Extensions exist (Chrome, Edge,
// Firefox, desktop Safari), since other browsers' native HLS varies a lot (Chrome's is new).
function prefersNativeHls(el) {
  if (!el.canPlayType('application/vnd.apple.mpegurl')) return false;
  return isAppleMobile || !Hls.isSupported();
}

// Attaches an HLS stream to a <video> or <audio>. Calls onReady once playable; returns a cleanup.
function attachHls(el, url, { onReady, onFatal }) {
  if (!prefersNativeHls(el) && Hls.isSupported()) {
    const hls = new Hls({ capLevelToPlayerSize: el.tagName === 'VIDEO' });
    let mediaRecoveries = 0;
    hls.on(Hls.Events.ERROR, (_event, data) => {
      if (!data.fatal) return;
      if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
        hls.startLoad();
      } else if (data.type === Hls.ErrorTypes.MEDIA_ERROR && mediaRecoveries < 2) {
        mediaRecoveries += 1;
        hls.recoverMediaError();
      } else {
        onFatal(data.details);
        hls.destroy();
      }
    });
    hls.on(Hls.Events.MANIFEST_PARSED, onReady);
    hls.loadSource(url);
    hls.attachMedia(el);
    return () => hls.destroy();
  }
  if (el.canPlayType('application/vnd.apple.mpegurl')) {
    const onError = () => onFatal('');
    el.addEventListener('error', onError);
    el.addEventListener('loadedmetadata', onReady, { once: true });
    el.src = url;
    return () => {
      el.removeEventListener('error', onError);
      el.removeEventListener('loadedmetadata', onReady);
      el.removeAttribute('src');
      el.load();
    };
  }
  onFatal('unsupported');
  return () => {};
}

// Cloudflare Stream keeps audio as its own HLS track (#EXT-X-MEDIA TYPE=AUDIO). Returns its URL or null.
export async function findAudioUrl(masterUrl) {
  const text = await (await fetch(masterUrl)).text();
  const line = text.split('\n').find((l) => l.startsWith('#EXT-X-MEDIA:') && l.includes('TYPE=AUDIO'));
  const uri = line?.match(/URI="([^"]+)"/)?.[1];
  return uri ? new URL(uri, masterUrl).href : null;
}

// Gestures: double-tap left/right = -10s/+10s, long-press = 2x while held, single tap = play/pause.
// Keys: J/L = -10s/+10s, K or Space = play/pause.
// Listen only: switches to an audio-only player at the same position. Phones keep audio players
// running when the screen locks (video players are paused), so this is what makes locked listening work.
export default function Player({ src, poster, title, startMs = 0, onTime, playerRef }) {
  const videoRef = useRef(null);
  const audioRef = useRef(null);
  const audioUrl = useRef(null);
  const audioCleanup = useRef(null);
  const listenRef = useRef(false);
  // Where to begin (resume point or ?t=), read once when the stream attaches.
  const startRef = useRef(startMs);
  startRef.current = startMs;
  const tapRef = useRef({ last: 0, timer: null, press: null, pressed: false });
  const [ripple, setRipple] = useState(null);
  const [fast, setFast] = useState(false);
  const [listenOnly, setListenOnly] = useState(false);
  const [switching, setSwitching] = useState(false);
  const [playError, setPlayError] = useState('');
  const [needsTap, setNeedsTap] = useState(false);
  const [speed, setSpeed] = useState(1);
  const speedRef = useRef(1);

  const active = () => (listenRef.current ? audioRef.current : videoRef.current);
  // Long-lived listeners (keyboard, lock screen) call the latest seek/togglePlay through this ref.
  const actions = useRef({});

  // Start playing as soon as the video is ready, always with sound. Browsers only allow that after
  // the viewer has interacted with the site (e.g. clicked a video card); when they refuse, wait
  // paused with a big Play button instead of playing muted.
  function autoplay(video) {
    video.muted = false;
    video.play().catch((err) => {
      if (err.name === 'NotAllowedError') setNeedsTap(true);
    });
  }

  function tapToPlay() {
    setNeedsTap(false);
    active()
      ?.play()
      .catch(() => {});
  }

  useEffect(() => {
    const video = videoRef.current;
    if (!src || !video) return;
    setPlayError('');
    setNeedsTap(false);
    audioUrl.current = null;
    // Look up the audio-only track now, so switching to Listen only is instant.
    findAudioUrl(src)
      .then((url) => (audioUrl.current = url))
      .catch(() => {});
    const detach = attachHls(video, src, {
      onReady: () => {
        if (startRef.current > 0 && video.currentTime < 1) video.currentTime = startRef.current / 1000;
        video.playbackRate = speedRef.current;
        autoplay(video);
      },
      onFatal: (details) =>
        setPlayError(
          details === 'unsupported'
            ? 'This browser can’t play this video. Try a current Chrome, Edge, Firefox, or Safari.'
            : `This video couldn’t play${details ? ` (${details})` : ''}. Refresh the page to try again.`,
        ),
    });
    return () => {
      detach();
      audioCleanup.current?.();
      audioCleanup.current = null;
      listenRef.current = false;
      setListenOnly(false);
    };
  }, [src]);

  useEffect(() => {
    if (playerRef) playerRef.current = active();
  }, [playerRef, listenOnly]);

  async function startListening() {
    const video = videoRef.current;
    const audio = audioRef.current;
    if (!video || !audio) return;
    setSwitching(true);
    try {
      const url = audioUrl.current || (audioUrl.current = await findAudioUrl(src));
      if (!url) throw new Error('no audio track');
      const at = video.currentTime;
      const wasPlaying = !video.paused;
      video.pause();
      setNeedsTap(false);
      audioCleanup.current?.();
      audioCleanup.current = attachHls(audio, url, {
        onReady: () => {
          audio.currentTime = at;
          audio.playbackRate = speedRef.current;
          if (wasPlaying) audio.play().catch(() => {});
        },
        onFatal: () => setPlayError('Listen only isn’t available for this video right now.'),
      });
      listenRef.current = true;
      setListenOnly(true);
    } catch {
      setPlayError('Listen only isn’t available for this video right now.');
    } finally {
      setSwitching(false);
    }
  }

  function stopListening() {
    const video = videoRef.current;
    const audio = audioRef.current;
    const at = audio?.currentTime || 0;
    const wasPlaying = audio && !audio.paused;
    audio?.pause();
    audioCleanup.current?.();
    audioCleanup.current = null;
    listenRef.current = false;
    setListenOnly(false);
    if (video) {
      video.currentTime = at;
      video.playbackRate = speedRef.current;
      if (wasPlaying) video.play().catch(() => {});
    }
  }

  // Lock-screen / notification controls act on whichever player is active.
  useEffect(() => {
    if (!('mediaSession' in navigator)) return;
    navigator.mediaSession.metadata = new MediaMetadata({
      title,
      artist: 'JimBob',
      artwork: poster ? [{ src: poster, sizes: '640x360', type: 'image/jpeg' }] : [],
    });
    navigator.mediaSession.setActionHandler('seekbackward', () => actions.current.seek(-10));
    navigator.mediaSession.setActionHandler('seekforward', () => actions.current.seek(10));
    navigator.mediaSession.setActionHandler('play', () => active()?.play());
    navigator.mediaSession.setActionHandler('pause', () => active()?.pause());
  }, [title, poster]);

  useEffect(() => {
    const onKey = (e) => {
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)) return;
      const k = e.key.toLowerCase();
      if (k === 'j') actions.current.seek(-10);
      else if (k === 'l') actions.current.seek(10);
      else if (k === 'k' || k === ' ') {
        e.preventDefault();
        actions.current.togglePlay();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  function seek(delta) {
    const v = active();
    if (!v) return;
    v.currentTime = Math.max(0, Math.min(v.duration || Infinity, v.currentTime + delta));
    setRipple({ side: delta < 0 ? 'left' : 'right', key: Date.now() });
  }

  function togglePlay() {
    const v = active();
    if (!v) return;
    v.paused ? v.play().catch(() => {}) : v.pause();
  }

  actions.current = { seek, togglePlay };

  const setRate = (rate) => {
    const v = active();
    if (v) v.playbackRate = rate;
  };

  const changeSpeed = (rate) => {
    speedRef.current = rate;
    setSpeed(rate);
    setRate(rate);
  };

  const onPointerDown = () => {
    const t = tapRef.current;
    t.pressed = false;
    t.press = setTimeout(() => {
      t.pressed = true;
      setRate(2);
      setFast(true);
    }, 450);
  };

  const onPointerUp = (e) => {
    const t = tapRef.current;
    clearTimeout(t.press);
    if (t.pressed) {
      setRate(speedRef.current);
      setFast(false);
      return;
    }
    const now = Date.now();
    const rect = e.currentTarget.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    if (now - t.last < 280) {
      clearTimeout(t.timer);
      t.last = 0;
      if (x < 0.4) seek(-10);
      else if (x > 0.6) seek(10);
      return;
    }
    t.last = now;
    t.timer = setTimeout(togglePlay, 280);
  };

  const onPointerLeave = () => {
    const t = tapRef.current;
    clearTimeout(t.press);
    if (t.pressed) {
      setRate(speedRef.current);
      setFast(false);
      t.pressed = false;
    }
  };

  const reportTime = (e) => {
    const isActive = (e.currentTarget === audioRef.current) === listenRef.current;
    if (isActive) onTime?.(e.currentTarget.currentTime);
  };

  return (
    <div className={`player ${listenOnly ? 'listen-only' : ''}`}>
      <video
        ref={videoRef}
        poster={poster || undefined}
        controls={!listenOnly}
        playsInline
        onTimeUpdate={reportTime}
        onSeeked={reportTime}
        onPlay={() => setNeedsTap(false)}
      />
      {playError && (
        <div className="player-error" role="alert">
          {playError}
        </div>
      )}
      {listenOnly && (
        <div className="listen-cover" style={poster ? { backgroundImage: `url(${poster})` } : undefined}>
          <span>Listening</span>
          <small>Audio keeps playing when you lock your phone.</small>
        </div>
      )}
      <div
        className="gesture-layer"
        onPointerDown={onPointerDown}
        onPointerUp={onPointerUp}
        onPointerLeave={onPointerLeave}
        onContextMenu={(e) => e.preventDefault()}
      />
      <audio
        ref={audioRef}
        className="listen-audio"
        controls
        preload="none"
        hidden={!listenOnly}
        onTimeUpdate={reportTime}
        onSeeked={reportTime}
      />
      {ripple && (
        <div key={ripple.key} className={`seek-ripple ${ripple.side}`} onAnimationEnd={() => setRipple(null)}>
          {ripple.side === 'left' ? '−10s' : '+10s'}
        </div>
      )}
      {fast && <div className="fast-badge">2× speed</div>}
      {needsTap && !listenOnly && (
        <button type="button" className="tap-to-play" onClick={tapToPlay} aria-label="Play">
          <svg viewBox="0 0 24 24" width="34" height="34" aria-hidden="true">
            <path d="M8 5v14l11-7z" fill="currentColor" />
          </svg>
        </button>
      )}
      <div className="player-tools">
        {!listenOnly && typeof document !== 'undefined' && document.pictureInPictureEnabled && (
          <button onClick={() => videoRef.current?.requestPictureInPicture().catch(() => {})}>
            Mini player
          </button>
        )}
        <label className="speed-pick">
          <span className="sr-only">Playback speed</span>
          <select id="playback-speed" value={speed} onChange={(e) => changeSpeed(Number(e.target.value))}>
            {SPEEDS.map((r) => (
              <option key={r} value={r}>
                {r}×
              </option>
            ))}
          </select>
        </label>
        <button onClick={listenOnly ? stopListening : startListening} disabled={switching}>
          {listenOnly ? 'Show video' : switching ? 'Switching…' : 'Listen only'}
        </button>
      </div>
    </div>
  );
}
