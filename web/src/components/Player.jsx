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

  useEffect(() => {
    const video = videoRef.current;
    if (!src || !video) return;
    if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = src;
    } else if (Hls.isSupported()) {
      const hls = new Hls({ capLevelToPlayerSize: true });
      hls.loadSource(src);
      hls.attachMedia(video);
      hlsRef.current = hls;
      return () => {
        hls.destroy();
        hlsRef.current = null;
      };
    }
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
    t.timer = setTimeout(togglePlay, 280);
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
      />
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
