import { useEffect, useRef, useState } from 'react';
import Hls from 'hls.js';

// Gestures: double-tap left/right = -10s/+10s, long-press = 2x while held, single tap = play/pause.
// Keys: J/L = -10s/+10s, K or Space = play/pause.
export default function Player({ src, poster, title, onTime, playerRef }) {
  const videoRef = useRef(null);
  const hlsRef = useRef(null);
  const tapRef = useRef({ last: 0, timer: null, press: null, pressed: false });
  const [ripple, setRipple] = useState(null);
  const [fast, setFast] = useState(false);
  const [listenOnly, setListenOnly] = useState(false);
  const [playError, setPlayError] = useState('');
  const [autoMuted, setAutoMuted] = useState(false);

  // Start playing as soon as the video is ready. Browsers allow sound only after the viewer has
  // interacted with the site (e.g. clicked a video card); otherwise start muted, like YouTube.
  function autoplay(video) {
    video.play().catch((err) => {
      if (err.name !== 'NotAllowedError') return;
      video.muted = true;
      setAutoMuted(true);
      video.play().catch(() => {});
    });
  }

  function unmute() {
    const v = videoRef.current;
    if (v) v.muted = false;
    setAutoMuted(false);
  }

  // Prefer hls.js wherever Media Source Extensions exist (Chrome, Edge, Firefox, desktop Safari).
  // Browser-native HLS varies a lot (Chrome's is new); only iPhone Safari, which lacks MSE, needs it.
  useEffect(() => {
    const video = videoRef.current;
    if (!src || !video) return;
    setPlayError('');
    setAutoMuted(false);
    if (Hls.isSupported()) {
      const hls = new Hls({ capLevelToPlayerSize: true });
      let mediaRecoveries = 0;
      hls.on(Hls.Events.ERROR, (_event, data) => {
        if (!data.fatal) return;
        if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
          hls.startLoad();
        } else if (data.type === Hls.ErrorTypes.MEDIA_ERROR && mediaRecoveries < 2) {
          mediaRecoveries += 1;
          hls.recoverMediaError();
        } else {
          setPlayError(`This video couldn’t play (${data.details}). Refresh the page to try again.`);
          hls.destroy();
        }
      });
      hls.on(Hls.Events.MANIFEST_PARSED, () => autoplay(video));
      hls.loadSource(src);
      hls.attachMedia(video);
      hlsRef.current = hls;
      return () => {
        hls.destroy();
        hlsRef.current = null;
      };
    }
    if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = src;
      const onError = () => setPlayError('This video couldn’t play. Refresh the page to try again.');
      const onReady = () => autoplay(video);
      video.addEventListener('error', onError);
      video.addEventListener('loadedmetadata', onReady, { once: true });
      return () => {
        video.removeEventListener('error', onError);
        video.removeEventListener('loadedmetadata', onReady);
      };
    }
    setPlayError('This browser can’t play this video. Try a current Chrome, Edge, Firefox, or Safari.');
  }, [src]);

  useEffect(() => {
    if (playerRef) playerRef.current = videoRef.current;
  }, [playerRef]);

  // Lock-screen / notification controls
  useEffect(() => {
    if (!('mediaSession' in navigator)) return;
    navigator.mediaSession.metadata = new MediaMetadata({
      title,
      artist: 'JimBob',
      artwork: poster ? [{ src: poster, sizes: '640x360', type: 'image/jpeg' }] : [],
    });
    const v = videoRef.current;
    navigator.mediaSession.setActionHandler('seekbackward', () => seek(-10));
    navigator.mediaSession.setActionHandler('seekforward', () => seek(10));
    navigator.mediaSession.setActionHandler('play', () => v?.play());
    navigator.mediaSession.setActionHandler('pause', () => v?.pause());
  }, [title, poster]);

  // Listen-only: hide video and drop to the lowest rendition to save data
  useEffect(() => {
    const hls = hlsRef.current;
    if (hls) hls.currentLevel = listenOnly ? 0 : -1;
  }, [listenOnly]);

  useEffect(() => {
    const onKey = (e) => {
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)) return;
      const k = e.key.toLowerCase();
      if (k === 'j') seek(-10);
      else if (k === 'l') seek(10);
      else if (k === 'k' || k === ' ') {
        e.preventDefault();
        togglePlay();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  function seek(delta) {
    const v = videoRef.current;
    if (!v) return;
    v.currentTime = Math.max(0, Math.min(v.duration || Infinity, v.currentTime + delta));
    setRipple({ side: delta < 0 ? 'left' : 'right', key: Date.now() });
  }

  function togglePlay() {
    const v = videoRef.current;
    if (!v) return;
    v.paused ? v.play() : v.pause();
  }

  const onPointerDown = () => {
    const t = tapRef.current;
    t.pressed = false;
    t.press = setTimeout(() => {
      t.pressed = true;
      videoRef.current.playbackRate = 2;
      setFast(true);
    }, 450);
  };

  const onPointerUp = (e) => {
    const t = tapRef.current;
    clearTimeout(t.press);
    if (t.pressed) {
      videoRef.current.playbackRate = 1;
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
    // While auto-muted and playing, a single tap unmutes instead of pausing (as on YouTube).
    // If it's paused, the tap plays it (and unmutes, since the viewer has now interacted).
    t.timer = setTimeout(() => {
      const v = videoRef.current;
      if (!v) return;
      const playingMuted = autoMuted && v.muted && !v.paused;
      if (autoMuted) unmute();
      if (!playingMuted) togglePlay();
    }, 280);
  };

  const onPointerLeave = () => {
    const t = tapRef.current;
    clearTimeout(t.press);
    if (t.pressed) {
      videoRef.current.playbackRate = 1;
      setFast(false);
      t.pressed = false;
    }
  };

  return (
    <div className={`player ${listenOnly ? 'listen-only' : ''}`}>
      <video
        ref={videoRef}
        poster={poster || undefined}
        controls
        playsInline
        onTimeUpdate={(e) => onTime?.(e.currentTarget.currentTime)}
        onSeeked={(e) => onTime?.(e.currentTarget.currentTime)}
        onVolumeChange={(e) => !e.currentTarget.muted && setAutoMuted(false)}
      />
      {playError && (
        <div className="player-error" role="alert">
          {playError}
        </div>
      )}
      {listenOnly && (
        <div className="listen-cover" style={poster ? { backgroundImage: `url(${poster})` } : undefined}>
          <span>Listening</span>
        </div>
      )}
      <div
        className="gesture-layer"
        onPointerDown={onPointerDown}
        onPointerUp={onPointerUp}
        onPointerLeave={onPointerLeave}
        onContextMenu={(e) => e.preventDefault()}
      />
      {ripple && (
        <div key={ripple.key} className={`seek-ripple ${ripple.side}`} onAnimationEnd={() => setRipple(null)}>
          {ripple.side === 'left' ? '−10s' : '+10s'}
        </div>
      )}
      {fast && <div className="fast-badge">2× speed</div>}
      {autoMuted && (
        <button type="button" className="unmute-btn" onClick={unmute}>
          <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
            <path d="M4 9h4l5-4v14l-5-4H4z" fill="currentColor" />
            <path d="m16 9 5 6m0-6-5 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
          Tap to unmute
        </button>
      )}
      <div className="player-tools">
        {typeof document !== 'undefined' && document.pictureInPictureEnabled && (
          <button onClick={() => videoRef.current?.requestPictureInPicture().catch(() => {})}>
            Mini player
          </button>
        )}
        <button onClick={() => setListenOnly((l) => !l)}>{listenOnly ? 'Show video' : 'Listen only'}</button>
      </div>
    </div>
  );
}
