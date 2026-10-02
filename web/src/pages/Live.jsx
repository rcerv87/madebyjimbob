import { useEffect, useRef, useState } from 'react';
import Hls from 'hls.js';
import { api } from '../api.js';
import useTitle from '../useTitle.js';

// /live (ADR-004): JimBob's stream on the platform's own server. Never starts muted: if the browser blocks sound,
// a Play button waits for a tap.
function LivePlayer({ src }) {
  const ref = useRef(null);
  const [needsTap, setNeedsTap] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || !src) return undefined;
    const play = () => el.play().catch(() => setNeedsTap(true));
    if (Hls.isSupported()) {
      const hls = new Hls({
        liveSyncDurationCount: 2,
        liveMaxLatencyDurationCount: 4,
        maxLiveSyncPlaybackRate: 1.1,
      });
      hls.loadSource(src);
      hls.attachMedia(el);
      hls.on(Hls.Events.MANIFEST_PARSED, play);
      return () => hls.destroy();
    }
    el.src = src;
    el.addEventListener('loadedmetadata', play, { once: true });
    return () => el.removeAttribute('src');
  }, [src]);
  return (
    <div className="live-player">
      <video ref={ref} playsInline controls aria-label="JimBob live" />
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
        <LivePlayer src={live.hls} />
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
