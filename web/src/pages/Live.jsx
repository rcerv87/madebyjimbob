import { useEffect, useMemo, useRef, useState } from 'react';
import { attachLive, attachRecording } from '../liveHls.js';
import { findAudioUrl } from '../components/Player.jsx';
import { isIOS } from '../device.js';
import { api } from '../api.js';
import useTitle from '../useTitle.js';
import { createClock, useClock } from '../clock.js';
import ChatPanel from '../components/ChatPanel.jsx';

// How far behind live the live feed itself runs (seconds); jumps closer than this to live just play live.
const LIVE_EDGE_S = 8;
// About how far the live feed runs behind the stream (seconds), for stamping live chat.
const LIVE_DELAY_S = 5;

// The chat follows the stream's clock; only it re-renders as time moves.
function SyncedChat({ clock, ...props }) {
  return <ChatPanel timeMs={useClock(clock)} {...props} />;
}

const hms = (s) => {
  const t = Math.max(0, Math.round(s));
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const sec = String(t % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
};

// Phones pause <video> when the screen locks but keep an audio player going.
const isPhone = () => isIOS() || /Android/i.test(navigator.userAgent);

function setMediaAction(action, handler) {
  try {
    navigator.mediaSession.setActionHandler(action, handler);
  } catch {
    /* not supported here */
  }
}

// /live (ADR-004, MBJ-310): JimBob's stream on the platform's own server. Plays the low-delay live feed; rewinding
// switches to the recording of the whole stream so far, and Back to LIVE switches back. Listen (or locking the phone)
// switches to the sound alone from the same spot, and back to video from wherever the sound got to. Never starts
// muted: if the browser blocks sound, a Play button waits for a tap.
function LivePlayer({ src, dvr, clock, seekRef }) {
  const ref = useRef(null);
  const audioRef = useRef(null);
  const audioUrl = useRef(null);
  const audioCleanup = useRef(null);
  const posRef = useRef(0); // where this viewer is in the stream, seconds from the start
  const lockListen = useRef(false);
  const hiddenAt = useRef(0);
  const pausedAt = useRef(0);
  const [needsTap, setNeedsTap] = useState(false);
  const [rewindTo, setRewindTo] = useState(null); // seconds from the start, or null = live
  const [attachKey, setAttachKey] = useState(0);
  const [listening, setListening] = useState(false);
  const listeningRef = useRef(false);
  const [, tick] = useState(0);
  // The recording skips the time OBS was away (gapS), so live on the recording is the clock minus that.
  const startedMs = dvr ? new Date(dvr.startedAt).getTime() + (dvr.gapS || 0) * 1000 : 0;
  const elapsed = () => Math.max(0, (Date.now() - startedMs) / 1000 - LIVE_EDGE_S);
  const liveAt = () => Math.max(0, (Date.now() - startedMs) / 1000 - LIVE_DELAY_S);

  // The video: the live feed, or the recording from `rewindTo`.
  useEffect(() => {
    const el = ref.current;
    if (!el || listening) return undefined;
    const play = () => el.play().catch(() => setNeedsTap(true));
    if (rewindTo !== null && dvr) return attachRecording(el, dvr.url, rewindTo, play);
    if (!src) return undefined;
    return attachLive(el, src, play);
    // Re-attach when the mode flips or after listening, not on every seek inside the recording.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src, dvr?.url, rewindTo === null, attachKey, listening]);

  // The sound alone (podcast mode) from the recording, if the recorder makes one.
  useEffect(() => {
    audioUrl.current = null;
    if (dvr?.url)
      findAudioUrl(dvr.url)
        .then((u) => (audioUrl.current = u))
        .catch(() => {});
  }, [dvr?.url]);

  // Keep track of where the viewer is (only while something plays), for the chat, the timeline, and switching.
  useEffect(() => {
    const t = setInterval(() => {
      const audio = audioRef.current;
      const video = ref.current;
      if (listeningRef.current) {
        if (audio && !audio.paused && dvr) posRef.current = audio.currentTime;
      } else if (video && !video.paused) {
        posRef.current = rewindTo === null ? liveAt() : video.currentTime;
      }
      clock?.set(Math.max(0, Math.round((posRef.current * 1000) / 250) * 250));
    }, 250);
    const slow = setInterval(() => tick((n) => n + 1), 1000);
    return () => {
      clearInterval(t);
      clearInterval(slow);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dvr, clock, rewindTo, startedMs]);

  // Back to video at a spot: live if it's at the live edge, otherwise the recording there.
  const showVideoAt = (at) => {
    if (!dvr || elapsed() - at < LIVE_EDGE_S) setRewindTo(null);
    else setRewindTo(at);
    setAttachKey((k) => k + 1);
  };

  function startListening() {
    const video = ref.current;
    const audio = audioRef.current;
    if (!audio || listeningRef.current) return;
    const at = posRef.current;
    video?.pause();
    audioCleanup.current?.();
    const play = () => audio.play().catch(() => {});
    // The sound alone if the recorder makes it; otherwise the recording, or the live feed, played as sound.
    audioCleanup.current = dvr
      ? attachRecording(audio, audioUrl.current || dvr.url, at, play)
      : attachLive(audio, src, play);
    listeningRef.current = true;
    setListening(true);
  }

  function stopListening() {
    const audio = audioRef.current;
    if (!listeningRef.current) return;
    const at = posRef.current;
    audio?.pause();
    audioCleanup.current?.();
    audioCleanup.current = null;
    listeningRef.current = false;
    setListening(false);
    showVideoAt(at);
  }

  // Phone locked while playing: carry on as sound. Unlocked: back to video from wherever the sound got to.
  useEffect(() => {
    const onVisibility = () => {
      if (document.hidden) {
        hiddenAt.current = Date.now();
        const video = ref.current;
        const playing = video && (!video.paused || hiddenAt.current - pausedAt.current < 1000);
        if (isPhone() && playing && !listeningRef.current && !document.pictureInPictureElement) {
          lockListen.current = true;
          startListening();
        }
      } else if (lockListen.current) {
        lockListen.current = false;
        stopListening();
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dvr, src]);

  // Paused by the phone as the page hid (not by the viewer): that's a lock too.
  const onVideoPause = () => {
    pausedAt.current = Date.now();
    if (document.hidden && pausedAt.current - hiddenAt.current < 1000 && isPhone() && !listeningRef.current) {
      lockListen.current = true;
      startListening();
    }
  };

  // Lock-screen controls act on whichever player is on.
  useEffect(() => {
    if (!('mediaSession' in navigator)) return undefined;
    navigator.mediaSession.metadata = new MediaMetadata({ title: 'JimBob live', artist: 'MADEbyJIMBOB' });
    const active = () => (listeningRef.current ? audioRef.current : ref.current);
    setMediaAction('play', () => active()?.play());
    setMediaAction('pause', () => active()?.pause());
    setMediaAction('seekbackward', () => seek(posRef.current - 10));
    setMediaAction('seekforward', () => seek(posRef.current + 10));
    return () => {
      navigator.mediaSession.metadata = null;
      for (const a of ['play', 'pause', 'seekbackward', 'seekforward']) setMediaAction(a, null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dvr]);

  useEffect(() => () => audioCleanup.current?.(), []);

  function seek(t) {
    if (!dvr) return;
    const target = Math.max(0, Math.min(t, elapsed()));
    posRef.current = target;
    if (listeningRef.current) {
      const audio = audioRef.current;
      if (audio) audio.currentTime = target;
      return;
    }
    if (elapsed() - target < LIVE_EDGE_S) {
      if (rewindTo !== null) setRewindTo(null);
      return;
    }
    if (rewindTo !== null && ref.current) ref.current.currentTime = target;
    else setRewindTo(target);
  }

  if (seekRef) seekRef.current = seek;
  const atLive = !listening && rewindTo === null;
  const now = atLive ? elapsed() : posRef.current;
  return (
    <div className="live-player">
      <video
        ref={ref}
        playsInline
        controls={!dvr}
        aria-label="JimBob live"
        onPause={onVideoPause}
        hidden={listening}
      />
      <audio ref={audioRef} hidden />
      {listening && (
        <div className="live-listening">
          <strong>🎧 Listening</strong>
          <span className="muted small">
            Sound only, uses about a tenth of the data. Keeps playing with the phone locked.
          </span>
        </div>
      )}
      {needsTap && !listening && (
        <button
          className="primary-btn live-tap"
          onClick={() => {
            setNeedsTap(false);
            ref.current?.play().catch(() => setNeedsTap(true));
          }}
        >
          ▶ Play live
        </button>
      )}
      <div className="live-controls">
        {dvr && (
          <>
            <button
              className="text-btn"
              onClick={() => {
                const el = listeningRef.current ? audioRef.current : ref.current;
                if (el?.paused) el.play();
                else el?.pause();
              }}
            >
              ⏯
            </button>
            <button className="text-btn" onClick={() => seek(now - 60)} aria-label="Back 1 minute">
              −1m
            </button>
            <button className="text-btn" onClick={() => seek(now - 10)} aria-label="Back 10 seconds">
              −10s
            </button>
            <input
              type="range"
              className="live-scrub"
              min={0}
              max={Math.max(1, Math.round(elapsed()))}
              value={Math.round(Math.min(now, elapsed()))}
              onChange={(e) => seek(Number(e.target.value))}
              aria-label="Rewind the stream"
            />
            {!atLive && (
              <button className="text-btn" onClick={() => seek(now + 10)} aria-label="Forward 10 seconds">
                +10s
              </button>
            )}
            <span className="small muted live-time">
              {atLive ? hms(elapsed()) : `${hms(now)} · ${hms(Math.max(0, liveAt() - now))} behind`}
            </span>
          </>
        )}
        <button
          className={listening ? 'primary-btn' : 'text-btn'}
          onClick={() => (listening ? stopListening() : startListening())}
          aria-pressed={listening}
        >
          {listening ? 'Watch' : '🎧 Listen'}
        </button>
        {dvr && (
          <button
            className={atLive ? 'live-badge live-go' : 'primary-btn live-go'}
            onClick={() => {
              if (listeningRef.current) {
                const audio = audioRef.current;
                if (audio) audio.currentTime = Math.max(0, elapsed());
                return;
              }
              setRewindTo(null);
            }}
            disabled={atLive}
          >
            {atLive ? 'LIVE' : 'Back to LIVE'}
          </button>
        )}
        {!listening && (
          <button
            className="text-btn"
            onClick={() => ref.current?.requestFullscreen?.()}
            aria-label="Full screen"
          >
            ⛶
          </button>
        )}
      </div>
    </div>
  );
}

export default function Live({ session }) {
  useTitle('Live');
  const [live, setLive] = useState(null);
  const clock = useMemo(() => createClock(), []);
  const seekRef = useRef(null);

  useEffect(() => {
    let stop = false;
    const load = () =>
      api('/live')
        .then((d) => !stop && setLive(d))
        .catch(() => !stop && setLive({ online: false }));
    load();
    const t = setInterval(load, 10000);
    return () => {
      stop = true;
      clearInterval(t);
    };
  }, []);

  if (!live) return <p className="muted page-msg">Loading…</p>;
  const videoId = live.online ? live.dvr?.videoId : null;
  return (
    <div className={videoId ? 'watch live-watch' : ''}>
      <div className="live-page watch-main">
        <div className="live-head">
          <h1>JimBob live</h1>
          {live.online && <span className="live-badge">LIVE</span>}
          {live.online && live.title && <span className="muted">{live.title}</span>}
        </div>
        {live.online && live.hls ? (
          <LivePlayer src={live.hls} dvr={live.dvr} clock={clock} seekRef={seekRef} />
        ) : (
          <div className="page-msg">
            <h2>JimBob isn’t live right now</h2>
            <p className="muted">
              He usually streams weekdays around noon Eastern. This page starts the stream when he goes live.
            </p>
          </div>
        )}
      </div>
      {videoId && (
        <SyncedChat
          clock={clock}
          videoId={videoId}
          getTimeMs={clock.get}
          onSeek={(ms) => seekRef.current?.(ms / 1000)}
          session={session}
          live
        />
      )}
    </div>
  );
}
