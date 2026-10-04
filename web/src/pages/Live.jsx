import { useEffect, useMemo, useRef, useState } from 'react';
import { attachLive, attachRecording } from '../liveHls.js';
import { findAudioUrl } from '../components/Player.jsx';
import { isIOS } from '../device.js';
import { api } from '../api.js';
import useTitle from '../useTitle.js';
import { createClock, useClock } from '../clock.js';
import ChatPanel from '../components/ChatPanel.jsx';
import SuperchatForm from '../components/SuperchatForm.jsx';
import { useSearchParams } from 'react-router-dom';

// How far behind live the live feed itself runs (seconds); jumps closer than this to live just play live.
const LIVE_EDGE_S = 8;
// Rewinds up to this far use the live feed's own buffer; further back, the recording (it runs ~3–5 s behind live).
const SHORT_REWIND_S = 10;
// The recording ends about this far behind live (2-second segments, uploaded as they're made).
const RECORDING_LAG_S = 6;
const SPEEDS = [1, 1.25, 1.5, 2];
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
// Hidden switch for diagnosing the timeline: localStorage 'mbj.debugLive' = '1' logs each decision to the console.
const dbg = (...a) => {
  try {
    if (localStorage.getItem('mbj.debugLive')) console.info('[live]', ...a);
  } catch {
    // storage blocked: no logging
  }
};

function LivePlayer({ src, dvr, clock, seekRef }) {
  const ref = useRef(null);
  // Full screen is the whole player (picture, timeline, controls), so rewinding works there too; the video alone
  // showed the browser's own controls, which only reach the live feed's last minutes.
  const playerRef = useRef(null);
  const [full, setFull] = useState(false);
  useEffect(() => {
    const onChange = () =>
      setFull(Boolean(playerRef.current) && document.fullscreenElement === playerRef.current);
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);
  const toggleFull = () => {
    if (document.fullscreenElement) return document.exitFullscreen?.();
    const box = playerRef.current;
    if (box?.requestFullscreen) return box.requestFullscreen().catch(() => {});
    // iPhone: only the video itself can go full screen (with Safari's own controls).
    ref.current?.webkitEnterFullscreen?.();
  };
  const audioRef = useRef(null);
  const audioUrl = useRef(null);
  const audioCleanup = useRef(null);
  const listenFromRef = useRef(null);
  const listenMode = useRef('snapshot');
  const posRef = useRef(0); // where this viewer is in the stream, seconds from the start
  const lockListen = useRef(false);
  const hiddenAt = useRef(0);
  const pausedAt = useRef(0);
  const [needsTap, setNeedsTap] = useState(false);
  const [rewindTo, setRewindTo] = useState(null); // seconds from the start, or null = live
  const [attachKey, setAttachKey] = useState(0);
  const [listening, setListening] = useState(false);
  // Seconds behind live while rewound a little on the live feed itself (0 = live).
  const [liveBehind, setLiveBehindState] = useState(0);
  const liveBehindRef = useRef(0);
  const setLiveBehind = (v) => {
    liveBehindRef.current = v;
    setLiveBehindState(v);
  };
  const liveCtl = useRef(null);
  // While dragging the timeline: where the thumb is (seconds), so it follows the finger and seeks once on release.
  const [drag, setDrag] = useState(null);
  // Mute (both players), e.g. when watching on the computer that's streaming, where OBS would capture the sound.
  const [muted, setMuted] = useState(false);
  // Catch-up speed while behind live (rewound or listening); at live it's always 1×.
  const [speed, setSpeed] = useState(1);
  const [goingLive, setGoingLive] = useState(false);
  const atLiveRef = useRef(true);
  const holdFastRef = useRef(false);
  const speedRef = useRef(1);
  const nowRef = useRef(0);
  useEffect(() => {
    if (ref.current) ref.current.muted = muted;
    if (audioRef.current) audioRef.current.muted = muted;
  }, [muted, listening, rewindTo, attachKey]);
  // Applied on every switch (a new source resets it), and every second so reaching live drops it to 1×.
  const rateRef = useRef(1);
  useEffect(() => {
    const t = setInterval(() => {
      for (const el of [ref.current, audioRef.current]) {
        if (el && el.playbackRate !== rateRef.current) {
          el.defaultPlaybackRate = rateRef.current;
          el.playbackRate = rateRef.current;
        }
      }
    }, 500);
    return () => clearInterval(t);
  }, []);
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
    if (rewindTo !== null && dvr) {
      dbg('attach recording at', Math.round(rewindTo));
      return attachRecording(el, dvr.url, rewindTo, play, (at) => {
        dbg('recording ended at', Math.round(at), 'live at', Math.round(liveAt()));
        // Reached the end of what was recorded when it loaded: carry on from here, or go live if it's close.
        posRef.current = at;
        if (liveAt() - at < SHORT_REWIND_S) setRewindTo(null);
        else {
          setRewindTo(at);
          setAttachKey((k) => k + 1);
        }
      });
    }
    if (!src) return undefined;
    liveBehindRef.current = 0;
    setLiveBehindState(0);
    dbg('attach live feed');
    const cleanup = attachLive(el, src, play);
    liveCtl.current = cleanup.control || null;
    return cleanup;
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
      } else if (video && rewindTo === null && liveBehindRef.current > 0) {
        // A little behind on the live feed: pausing falls further behind, faster speeds catch up; caught up = live.
        const next = liveBehindRef.current + (video.paused ? 0.25 : (1 - video.playbackRate) * 0.25);
        if (next < 1.5) {
          dbg('caught up: live');
          liveCtl.current?.toLive();
          setLiveBehind(0);
        } else setLiveBehind(next);
        posRef.current = liveAt() - liveBehindRef.current;
      } else if (video && !video.paused) {
        posRef.current = rewindTo === null ? liveAt() - liveBehindRef.current : video.currentTime;
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
    // The sound alone if the recorder makes it; otherwise the recording, or the live feed, played as sound. At the end of
    // what was recorded when it loaded, it reloads from there, so listening keeps going.
    // Within a few seconds of live it follows the recording's growing end; further back it plays a snapshot from that
    // spot, which hands over to following when it reaches the end.
    const listenFrom = (from) => {
      audioCleanup.current?.();
      const follow = liveAt() - from < 6;
      audioCleanup.current = attachRecording(
        audio,
        audioUrl.current || dvr.url,
        from,
        play,
        (end) => {
          posRef.current = end;
          listenFrom(end);
        },
        { follow },
      );
      listenMode.current = follow ? 'follow' : 'snapshot';
    };
    listenFromRef.current = listenFrom;
    if (dvr) listenFrom(at);
    else audioCleanup.current = attachLive(audio, src, play);
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
    const live = liveAt();
    const target = Math.max(0, Math.min(t, live));
    posRef.current = target;
    if (listeningRef.current) {
      const audio = audioRef.current;
      // Inside what's loaded (snapshot): just move. Otherwise (past the loaded end, or near live): reload from there.
      const loaded = listenMode.current === 'snapshot' && audio && target < (audio.duration || 0) - 2;
      if (loaded && live - target >= 6) audio.currentTime = target;
      else listenFromRef.current?.(target);
      return;
    }
    const behind = live - target;
    dbg('seek', {
      asked: Math.round(t),
      target: Math.round(target),
      live: Math.round(live),
      behind: Math.round(behind),
      inRecording: rewindTo !== null,
      loaded: Math.round(ref.current?.duration || 0),
    });
    // At live: back to the live edge.
    if (behind < 1.5) {
      if (rewindTo !== null) setRewindTo(null);
      else if (liveBehindRef.current) {
        liveCtl.current?.toLive();
        setLiveBehind(0);
      }
      return;
    }
    // A few seconds back while on the live feed ("what did he say?"): its own buffer.
    if (behind <= SHORT_REWIND_S && rewindTo === null) {
      if (liveCtl.current?.seekBy(behind - liveBehindRef.current)) setLiveBehind(behind);
      return;
    }
    // From the recording to the last seconds: the recording reaches to ~RECORDING_LAG_S behind live, so it plays
    // anything older; closer than that is live. (Switching to a fresh live feed and stepping back in it failed: it
    // hasn't loaded those seconds yet, and the video stalled or landed at live.)
    if (behind < RECORDING_LAG_S) {
      setRewindTo(null);
      return;
    }
    // Further back: the recording. Inside what's loaded, just move; past it (the recording has grown since it loaded),
    // load it again from there, or the player stops at the old end.
    setLiveBehind(0);
    const video = ref.current;
    if (rewindTo !== null && video && target < (video.duration || 0) - 1) video.currentTime = target;
    else {
      if (rewindTo !== null) setAttachKey((k) => k + 1);
      setRewindTo(target);
    }
  }

  // ---------- touch and mouse gestures on the video ----------
  // Double-tap left/right: -10 s/+10 s (middle: reset zoom). Tap: play/pause. Hold right: 2× while behind live. Hold
  // left: rewind at 2× (a counter while held, one jump on release; video can't play backwards smoothly). Pinch: zoom
  // up to 3×, drag to look around while zoomed.
  const gesture = useRef({
    pointers: new Map(),
    last: 0,
    timer: 0,
    press: 0,
    holding: null,
    back: 0,
    backTimer: 0,
  });
  const [hint, setHint] = useState(null); // { text, side }
  const [zoom, setZoom] = useState({ scale: 1, x: 0, y: 0 });
  const showHint = (text, side = 'center', ms = 700) => {
    setHint({ text, side, at: Date.now() });
    clearTimeout(gesture.current.hintTimer);
    if (ms) gesture.current.hintTimer = setTimeout(() => setHint(null), ms);
  };
  const activeEl = () => (listeningRef.current ? audioRef.current : ref.current);
  const togglePlay = () => {
    const el = activeEl();
    if (!el) return;
    if (el.paused) el.play().catch(() => {});
    else el.pause();
  };
  const sideOf = (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    return x < 0.4 ? 'left' : x > 0.6 ? 'right' : 'center';
  };
  const endHold = () => {
    const g = gesture.current;
    if (g.holding === 'right') {
      holdFastRef.current = false;
      rateRef.current = Math.max(1, Math.min(2, atLiveRef.current ? 1 : speedRef.current));
      setHint(null);
    } else if (g.holding === 'left') {
      clearInterval(g.backTimer);
      if (g.back > 0) seek(nowRef.current - g.back);
      setHint(null);
    }
    g.holding = null;
    g.back = 0;
  };
  const onGestureDown = (e) => {
    const g = gesture.current;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    g.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, startX: e.clientX, startY: e.clientY });
    if (g.pointers.size === 2) {
      // Pinch starts: no taps or holds.
      clearTimeout(g.press);
      const [a, b] = [...g.pointers.values()];
      g.pinch = { dist: Math.hypot(a.x - b.x, a.y - b.y), scale: zoom.scale };
      return;
    }
    const side = sideOf(e);
    g.moved = false;
    g.press = setTimeout(() => {
      if (g.moved || g.pointers.size !== 1) return;
      if (side === 'right') {
        if (atLiveRef.current) return showHint('At live: nothing ahead yet', 'right', 1200);
        g.holding = 'right';
        holdFastRef.current = true;
        rateRef.current = 2;
        showHint('⏩ 2×', 'right', 0);
      } else if (side === 'left') {
        g.holding = 'left';
        g.back = 0;
        showHint('⏪ 2×', 'left', 0);
        // Rewinding at 2×: 2 s further back for every second held; the counter is exactly where it will land.
        g.backTimer = setInterval(() => {
          g.back += 2;
          showHint(`⏪ −${g.back}s`, 'left', 0);
        }, 1000);
      }
    }, 450);
  };
  const onGestureMove = (e) => {
    const g = gesture.current;
    const p = g.pointers.get(e.pointerId);
    if (!p) return;
    const dx = e.clientX - p.x;
    const dy = e.clientY - p.y;
    p.x = e.clientX;
    p.y = e.clientY;
    if (Math.hypot(p.x - p.startX, p.y - p.startY) > 12) g.moved = true;
    if (g.pointers.size === 2 && g.pinch) {
      const [a, b] = [...g.pointers.values()];
      const scale = Math.max(
        1,
        Math.min(3, (g.pinch.scale * Math.hypot(a.x - b.x, a.y - b.y)) / g.pinch.dist),
      );
      setZoom((z) => (scale === 1 ? { scale: 1, x: 0, y: 0 } : { ...z, scale }));
    } else if (g.pointers.size === 1 && zoom.scale > 1 && g.moved && !g.holding) {
      // Zoomed in: drag to look around (kept inside the picture).
      const rect = e.currentTarget.getBoundingClientRect();
      const maxX = ((zoom.scale - 1) * rect.width) / 2;
      const maxY = ((zoom.scale - 1) * rect.height) / 2;
      setZoom((z) => ({
        ...z,
        x: Math.max(-maxX, Math.min(maxX, z.x + dx)),
        y: Math.max(-maxY, Math.min(maxY, z.y + dy)),
      }));
    }
  };
  const onGestureUp = (e) => {
    const g = gesture.current;
    const wasPinch = g.pointers.size === 2 || g.pinch;
    g.pointers.delete(e.pointerId);
    clearTimeout(g.press);
    if (g.pointers.size === 0) g.pinch = null;
    if (wasPinch) return;
    if (g.holding) return endHold();
    if (g.moved) return;
    const side = sideOf(e);
    const now = Date.now();
    if (now - g.last < 280) {
      clearTimeout(g.timer);
      g.last = 0;
      if (side === 'left') {
        seek(nowRef.current - 10);
        showHint('−10s', 'left');
      } else if (side === 'right') {
        if (atLiveRef.current) showHint('At live', 'right');
        else {
          seek(nowRef.current + 10);
          showHint('+10s', 'right');
        }
      } else setZoom({ scale: 1, x: 0, y: 0 });
      return;
    }
    g.last = now;
    g.timer = setTimeout(togglePlay, 280);
  };
  const onGestureCancel = (e) => {
    const g = gesture.current;
    g.pointers.delete(e.pointerId);
    clearTimeout(g.press);
    if (g.holding) endHold();
  };

  if (seekRef) seekRef.current = seek;
  const onLiveFeed = !listening && rewindTo === null;
  // Listening counts as live once it's within a few seconds of it (following the recording's end).
  const listeningLive = listening && liveAt() - posRef.current < 8;
  const atLive = (onLiveFeed && liveBehind < 1.5) || listeningLive || goingLive;
  // Faster speeds only while behind; caught up (watching or listening) it's 1×.
  const rate = atLive ? 1 : speed;
  atLiveRef.current = atLive;
  speedRef.current = speed;
  rateRef.current = holdFastRef.current ? 2 : Math.max(1, Math.min(2, rate));
  const now = onLiveFeed ? liveAt() - liveBehind : posRef.current;
  nowRef.current = now;
  return (
    <div className="live-player" ref={playerRef}>
      <video
        ref={ref}
        playsInline
        controls={!dvr}
        style={
          zoom.scale > 1
            ? { transform: `translate(${zoom.x}px, ${zoom.y}px) scale(${zoom.scale})` }
            : undefined
        }
        aria-label="JimBob live"
        onPause={onVideoPause}
        // Only one player ever makes sound: playing the video stops the listening player, and the other way round.
        onPlay={() => {
          if (listeningRef.current) ref.current?.pause();
          else audioRef.current?.pause();
        }}
        hidden={listening}
      />
      <audio
        ref={audioRef}
        hidden
        onPlay={() => {
          if (!listeningRef.current) audioRef.current?.pause();
          else ref.current?.pause();
        }}
      />
      {dvr && !listening && (
        <div
          className="live-gestures"
          onPointerDown={onGestureDown}
          onPointerMove={onGestureMove}
          onPointerUp={onGestureUp}
          onPointerCancel={onGestureCancel}
          onContextMenu={(e) => e.preventDefault()}
          aria-hidden="true"
        />
      )}
      {hint && <div className={`live-hint ${hint.side}`}>{hint.text}</div>}
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
      {dvr && (
        <div className="live-timeline">
          <input
            type="range"
            className="live-scrub"
            min={0}
            max={Math.max(1, Math.round(liveAt()))}
            value={Math.round(drag ?? Math.min(now, liveAt()))}
            onChange={(e) => setDrag(Number(e.target.value))}
            onPointerUp={(e) => {
              dbg('timeline release', e.currentTarget.value, 'of', e.currentTarget.max, 'drag', drag);
              seek(Number(e.currentTarget.value));
              setDrag(null);
            }}
            onKeyUp={(e) => {
              seek(Number(e.currentTarget.value));
              setDrag(null);
            }}
            onBlur={() => setDrag(null)}
            aria-label="Rewind the stream"
          />
        </div>
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
            {!atLive && (
              <button className="text-btn" onClick={() => seek(now + 10)} aria-label="Forward 10 seconds">
                +10s
              </button>
            )}
            <span className="small muted live-time">
              {drag !== null
                ? `Go to ${hms(drag)} · ${hms(Math.max(0, liveAt() - drag))} behind`
                : atLive
                  ? hms(liveAt())
                  : `${hms(now)} · ${hms(Math.max(0, liveAt() - now))} behind`}
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
              if (goingLive) return;
              // Instant feedback: the switch can take a second or two (the listening player reloads at the live end).
              setGoingLive(true);
              setTimeout(() => setGoingLive(false), 2500);
              posRef.current = liveAt();
              if (listeningRef.current) {
                listenFromRef.current?.(liveAt());
                return;
              }
              if (rewindTo !== null) setRewindTo(null);
              else {
                liveCtl.current?.toLive();
                setLiveBehind(0);
              }
            }}
            disabled={atLive}
          >
            {goingLive ? 'Going live…' : atLive ? 'LIVE' : 'Back to LIVE'}
          </button>
        )}
        {dvr && (
          <button
            className="text-btn"
            onClick={() => setSpeed((v) => SPEEDS[(SPEEDS.indexOf(v) + 1) % SPEEDS.length])}
            aria-label={`Playback speed ${speed}×`}
            title={atLive ? 'Speed applies when you’re behind live' : 'Playback speed'}
          >
            {rate}×
          </button>
        )}
        <button
          className="text-btn"
          onClick={() => setMuted((m) => !m)}
          aria-pressed={muted}
          aria-label={muted ? 'Unmute' : 'Mute'}
        >
          {muted ? '🔇 Muted' : '🔊'}
        </button>
        {!listening && (
          <button
            className="text-btn"
            onClick={toggleFull}
            aria-label={full ? 'Exit full screen' : 'Full screen'}
          >
            {full ? '✕' : '⛶'}
          </button>
        )}
      </div>
    </div>
  );
}

export default function Live({ session }) {
  useTitle('Live');
  const [live, setLive] = useState(null);
  // Super chats through the site (MBJ-109): a button while live; ?superchat=sent after paying.
  const [superchatOpen, setSuperchatOpen] = useState(false);
  const [params] = useSearchParams();
  const sent = params.get('superchat') === 'sent';
  const [payments, setPayments] = useState(false);
  useEffect(() => {
    api('/membership')
      .then((d) => setPayments(d.configured))
      .catch(() => {});
  }, []);
  const clock = useMemo(() => createClock(), []);
  const seekRef = useRef(null);

  useEffect(() => {
    let stop = false;
    const load = () =>
      api('/live')
        // Still live but this answer lacks the recording (a hiccup reading it): keep the last one, so the chat and
        // rewind controls don't vanish.
        .then(
          (d) =>
            !stop &&
            setLive((prev) => (d.online && !d.dvr && prev?.online && prev.dvr ? { ...d, dvr: prev.dvr } : d)),
        )
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
          {payments && (
            <button
              type="button"
              className="primary-btn superchat-btn"
              onClick={() => setSuperchatOpen(true)}
            >
              $ Super chat
            </button>
          )}
        </div>
        {sent && (
          <p className="notice" role="status">
            Thanks! Your super chat is in the chat.
          </p>
        )}
        {superchatOpen && (
          <div className="dialog-backdrop" onClick={() => setSuperchatOpen(false)}>
            <div
              className="dialog"
              role="dialog"
              aria-modal="true"
              aria-label="Send a super chat"
              onClick={(e) => e.stopPropagation()}
            >
              <h2>Super chat JimBob</h2>
              <SuperchatForm session={session} returnTo="/live" onDone={() => setSuperchatOpen(false)} />
              <div className="dialog-actions">
                <button type="button" className="text-btn" onClick={() => setSuperchatOpen(false)}>
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}
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
