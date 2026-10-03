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
// Rewinds up to this far use the live feed's own buffer (the recording runs ~10–15 s behind live).
const SHORT_REWIND_S = 25;
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
function LivePlayer({ src, dvr, clock, seekRef }) {
  const ref = useRef(null);
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
  const pendingBehind = useRef(0);
  // While dragging the timeline: where the thumb is (seconds), so it follows the finger and seeks once on release.
  const [drag, setDrag] = useState(null);
  // Mute (both players), e.g. when watching on the computer that's streaming, where OBS would capture the sound.
  const [muted, setMuted] = useState(false);
  // Catch-up speed while behind live (rewound or listening); at live it's always 1×.
  const [speed, setSpeed] = useState(1);
  const [goingLive, setGoingLive] = useState(false);
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
    if (rewindTo !== null && dvr)
      return attachRecording(el, dvr.url, rewindTo, play, (at) => {
        // Reached the end of what was recorded when it loaded: carry on from here, or go live if it's close.
        posRef.current = at;
        if (liveAt() - at < 30) setRewindTo(null);
        else {
          setRewindTo(at);
          setAttachKey((k) => k + 1);
        }
      });
    if (!src) return undefined;
    liveBehindRef.current = 0;
    setLiveBehindState(0);
    const cleanup = attachLive(el, src, () => {
      play();
      // Came from the recording to a spot a few seconds behind live: step back once the live feed has some buffer.
      const behind = pendingBehind.current;
      pendingBehind.current = 0;
      if (behind)
        setTimeout(() => {
          if (cleanup.control?.seekBy(behind)) setLiveBehind(behind);
        }, 1500);
    });
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
  // Rewound only a little: the player catches up with the end of the recording (it's saved in 6-second chunks, so it
  // runs ~10–15 s behind live) and keeps waiting for the next chunk. Within 30 s of live, waiting means go live.
  const onVideoWaiting = () => {
    const video = ref.current;
    if (!video || listeningRef.current || rewindTo === null || !dvr) return;
    if (liveAt() - video.currentTime < 30) {
      posRef.current = liveAt();
      setRewindTo(null);
    }
  };

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
    // At live: back to the live edge.
    if (behind < 1.5) {
      if (rewindTo !== null) setRewindTo(null);
      else if (liveBehindRef.current) {
        liveCtl.current?.toLive();
        setLiveBehind(0);
      }
      return;
    }
    // A few seconds back ("what did he say?"): the live feed's own buffer, which the recording can't reach yet.
    if (behind <= SHORT_REWIND_S) {
      if (rewindTo === null) {
        if (liveCtl.current?.seekBy(behind - liveBehindRef.current)) setLiveBehind(behind);
        return;
      }
      pendingBehind.current = behind;
      setRewindTo(null);
      return;
    }
    // Further back: the recording.
    setLiveBehind(0);
    if (rewindTo !== null && ref.current) ref.current.currentTime = target;
    else setRewindTo(target);
  }

  if (seekRef) seekRef.current = seek;
  const onLiveFeed = !listening && rewindTo === null;
  // Listening counts as live once it's within a few seconds of it (following the recording's end).
  const listeningLive = listening && liveAt() - posRef.current < 8;
  const atLive = (onLiveFeed && liveBehind < 1.5) || listeningLive || goingLive;
  // Faster speeds only while behind; caught up (watching or listening) it's 1×.
  const rate = atLive ? 1 : speed;
  rateRef.current = Math.max(1, Math.min(2, rate));
  const now = onLiveFeed ? liveAt() - liveBehind : posRef.current;
  return (
    <div className="live-player">
      <video
        ref={ref}
        playsInline
        controls={!dvr}
        aria-label="JimBob live"
        onPause={onVideoPause}
        // Only one player ever makes sound: playing the video stops the listening player, and the other way round.
        onPlay={() => {
          if (listeningRef.current) ref.current?.pause();
          else audioRef.current?.pause();
        }}
        onWaiting={onVideoWaiting}
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
