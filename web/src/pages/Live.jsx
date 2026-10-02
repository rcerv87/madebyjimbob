import { useEffect, useRef, useState } from 'react';
import { attachLive, attachRecording } from '../liveHls.js';
import { api } from '../api.js';
import useTitle from '../useTitle.js';

// How far behind live the live feed itself runs (seconds); jumps closer than this to live just play live.
const LIVE_EDGE_S = 8;

const hms = (s) => {
  const t = Math.max(0, Math.round(s));
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const sec = String(t % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
};

// /live (ADR-004, MBJ-310): JimBob's stream on the platform's own server. Plays the low-delay live feed; rewinding
// switches to the recording of the whole stream so far, and Back to LIVE switches back. Never starts muted: if the
// browser blocks sound, a Play button waits for a tap.
function LivePlayer({ src, dvr }) {
  const ref = useRef(null);
  const [needsTap, setNeedsTap] = useState(false);
  const [rewindTo, setRewindTo] = useState(null); // seconds from the start, or null = live
  const [pos, setPos] = useState(0);
  const [, tick] = useState(0);
  const startedMs = dvr ? new Date(dvr.startedAt).getTime() : 0;
  const elapsed = () => Math.max(0, (Date.now() - startedMs) / 1000 - LIVE_EDGE_S);

  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const play = () => el.play().catch(() => setNeedsTap(true));
    if (rewindTo !== null && dvr) return attachRecording(el, dvr.url, rewindTo, play);
    if (!src) return undefined;
    return attachLive(el, src, play);
    // Switching sources only when the mode flips, not on every seek inside the recording.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src, dvr?.url, rewindTo === null]);

  // Clock for the timeline.
  useEffect(() => {
    if (!dvr) return undefined;
    const t = setInterval(() => {
      tick((n) => n + 1);
      if (ref.current && rewindTo !== null) setPos(ref.current.currentTime);
    }, 1000);
    return () => clearInterval(t);
  }, [dvr, rewindTo]);

  const seek = (t) => {
    if (!dvr) return;
    const target = Math.max(0, Math.min(t, elapsed()));
    if (elapsed() - target < LIVE_EDGE_S) return setRewindTo(null);
    if (rewindTo !== null && ref.current) {
      ref.current.currentTime = target;
      setPos(target);
    } else {
      setRewindTo(target);
      setPos(target);
    }
  };

  const atLive = rewindTo === null;
  const now = atLive ? elapsed() : pos;
  return (
    <div className="live-player">
      <video ref={ref} playsInline controls={!dvr} aria-label="JimBob live" />
      {needsTap && (
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
        <div className="live-controls">
          <button
            className="text-btn"
            onClick={() => (ref.current?.paused ? ref.current.play() : ref.current?.pause())}
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
            value={Math.round(now)}
            onChange={(e) => seek(Number(e.target.value))}
            aria-label="Rewind the stream"
          />
          {!atLive && (
            <button className="text-btn" onClick={() => seek(now + 10)} aria-label="Forward 10 seconds">
              +10s
            </button>
          )}
          <span className="small muted live-time">
            {atLive ? hms(elapsed()) : `${hms(pos)} · ${hms(elapsed() - pos)} behind`}
          </span>
          <button
            className={atLive ? 'live-badge live-go' : 'primary-btn live-go'}
            onClick={() => setRewindTo(null)}
            disabled={atLive}
          >
            {atLive ? 'LIVE' : 'Back to LIVE'}
          </button>
          <button
            className="text-btn"
            onClick={() => ref.current?.requestFullscreen?.()}
            aria-label="Full screen"
          >
            ⛶
          </button>
        </div>
      )}
    </div>
  );
}

export default function Live() {
  useTitle('Live');
  const [live, setLive] = useState(null);

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
  return (
    <div className="live-page">
      <div className="live-head">
        <h1>JimBob live</h1>
        {live.online && <span className="live-badge">LIVE</span>}
        {live.online && live.title && <span className="muted">{live.title}</span>}
      </div>
      {live.online && live.hls ? (
        <LivePlayer src={live.hls} dvr={live.dvr} />
      ) : (
        <div className="page-msg">
          <h2>JimBob isn’t live right now</h2>
          <p className="muted">
            He usually streams weekdays around noon Eastern. This page starts the stream when he goes live.
          </p>
        </div>
      )}
    </div>
  );
}
