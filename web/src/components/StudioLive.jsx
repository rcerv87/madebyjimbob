import { useCallback, useEffect, useRef, useState } from 'react';
import { attachLive } from '../liveHls.js';
import { api } from '../api.js';

// Plays the live stream (muted preview, so Studio doesn't echo JimBob's own mic).
function LivePreview({ src }) {
  const ref = useRef(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || !src) return undefined;
    return attachLive(el, src, () => el.play().catch(() => {}));
  }, [src]);
  return <video ref={ref} className="live-preview" muted playsInline controls aria-label="Live preview" />;
}

function Copy({ label, value, secret }) {
  const [shown, setShown] = useState(!secret);
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setShown(true);
    }
  };
  return (
    <div className="live-field">
      <span className="muted small">{label}</span>
      <code>{shown ? value || '(not set)' : '••••••••'}</code>
      {secret && (
        <button className="text-btn" onClick={() => setShown(!shown)}>
          {shown ? 'Hide' : 'Show'}
        </button>
      )}
      <button className="text-btn" onClick={copy} disabled={!value}>
        {copied ? 'Copied' : 'Copy'}
      </button>
    </div>
  );
}

const since = (iso) => {
  const m = Math.max(0, Math.round((Date.now() - new Date(iso)) / 60000));
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`;
};

const SERVER_STATE = {
  off: 'Server off',
  starting: 'Starting server…',
  ready: 'Server ready',
  stopping: 'Shutting down…',
};

const STEPS = [
  'Creating the server',
  'Starting the streaming software',
  'Applying settings',
  'Ready for OBS',
  'Live',
];

// Which step Go Live is on: 0–2 while starting, 3 ready (OBS can connect), 4 live.
function stepOf(live) {
  const srv = live.server || {};
  if (live.online) return 4;
  if (srv.status === 'ready') return 3;
  if (srv.status !== 'starting') return -1;
  if (!srv.created) return 0;
  return srv.answering ? 2 : 1;
}

const clock = (since) => {
  const s = Math.max(0, Math.round((Date.now() - new Date(since)) / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

// A short two-note chime when the server becomes ready (the page was clicked, so browsers allow sound).
function chime() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    [880, 1320].forEach((f, i) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.frequency.value = f;
      g.gain.setValueAtTime(0.15, ctx.currentTime + i * 0.18);
      g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + i * 0.18 + 0.3);
      o.connect(g).connect(ctx.destination);
      o.start(ctx.currentTime + i * 0.18);
      o.stop(ctx.currentTime + i * 0.18 + 0.32);
    });
  } catch {
    // no sound available
  }
}

function LiveSteps({ live }) {
  const step = stepOf(live);
  const [, tick] = useState(0);
  useEffect(() => {
    if (step < 0 || step > 2) return undefined;
    const t = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [step]);
  if (step < 0) return null;
  return (
    <div className={`live-steps live-step-${step}`}>
      {step === 3 && (
        <div className="live-ready" role="status">
          <strong>Ready to stream</strong>
          <span>Start streaming in OBS now.</span>
        </div>
      )}
      <ol>
        {STEPS.map((label, i) => (
          <li key={label} className={i < step ? 'done' : i === step ? 'current' : ''}>
            <span className="live-dot" aria-hidden="true">
              {i < step ? '✓' : i + 1}
            </span>
            {label}
            {i === step && step < 3 && live.server?.createdAt && (
              <span className="muted small"> · {clock(live.server.createdAt)}</span>
            )}
          </li>
        ))}
      </ol>
    </div>
  );
}

// Studio → Live (ADR-004): Go Live starts the streaming server on Hetzner (or uses Ruben's local test server),
// then shows whether the stream is on, a preview, and what to put in OBS.
export default function StudioLive() {
  const [live, setLive] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirmEnd, setConfirmEnd] = useState(false);

  const load = useCallback(
    () =>
      api('/studio/live')
        .then((d) => (setLive(d), setError('')))
        .catch((e) => setError(e.message)),
    [],
  );
  useEffect(() => {
    load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, [load]);

  const act = async (path) => {
    setBusy(true);
    setError('');
    try {
      setLive(await api(`/studio/live/${path}`, { method: 'POST' }));
    } catch (err) {
      setError(err.message);
    }
    setBusy(false);
    setConfirmEnd(false);
  };

  const step = live ? stepOf(live) : -1;
  const lastStep = useRef(step);
  useEffect(() => {
    if (lastStep.current >= 0 && lastStep.current < 3 && step === 3) chime();
    lastStep.current = step;
    const base = document.title.replace(/^(● Ready · |● LIVE · )/, '');
    document.title = step === 3 ? `● Ready · ${base}` : step === 4 ? `● LIVE · ${base}` : base;
  }, [step]);

  if (!live?.configured) return null;
  const hetzner = live.mode === 'hetzner';
  const state = live.server?.status || 'off';
  const ready = state === 'ready';
  return (
    <section className="panel live-panel">
      <div className="live-head">
        <h2>Live</h2>
        {live.online ? <span className="live-badge">LIVE</span> : <span className="badge">Offline</span>}
        {live.online && (
          <span className="muted small">
            {live.viewers} watching{live.startedAt ? ` · on for ${since(live.startedAt)}` : ''}
          </span>
        )}
        {live.online && (
          <a className="text-btn" href="/live" target="_blank" rel="noreferrer">
            Open the viewer page
          </a>
        )}
      </div>

      {hetzner && (
        <div className="live-server">
          <span className={`small ${state === 'starting' ? 'live-pending' : ''}`}>
            {live.server?.saving
              ? 'Saving a faster-start copy of the server, then deleting it (about 2 minutes)…'
              : SERVER_STATE[state] || state}
          </span>
          {state === 'off' && (
            <button className="primary-btn" disabled={busy} onClick={() => act('start')}>
              {busy ? 'Starting…' : 'Go Live'}
            </button>
          )}
          {(state === 'starting' || ready) &&
            (confirmEnd ? (
              <span className="live-confirm">
                <span className="small">End the stream and delete the server?</span>
                <button className="danger-btn" disabled={busy} onClick={() => act('stop')}>
                  End stream
                </button>
                <button className="text-btn" onClick={() => setConfirmEnd(false)}>
                  Keep going
                </button>
              </span>
            ) : (
              <button className="text-btn" disabled={busy} onClick={() => setConfirmEnd(true)}>
                End stream
              </button>
            ))}
          {live.server?.error && <span className="error small">{live.server.error}</span>}
        </div>
      )}
      {hetzner && <LiveSteps live={live} />}

      {error && <p className="error small">{error}</p>}
      {live.error && ready && <p className="error small">{live.error}</p>}
      {live.online ? (
        <LivePreview src={live.hls} />
      ) : (
        <p className="muted small">
          {hetzner && state === 'off'
            ? 'Click Go Live a few minutes before the stream. Then start streaming in OBS.'
            : hetzner && state === 'starting'
              ? 'You can open OBS now; start streaming once this says Server ready.'
              : 'Start streaming in OBS and the preview appears here within about 20 seconds.'}
        </p>
      )}

      <details className="live-obs" open={!live.online}>
        <summary>OBS settings (set up once)</summary>
        <p className="muted small">OBS → Settings → Stream → Service: Custom…</p>
        <Copy label="Server" value={live.obs.server || 'Appears after the first Go Live'} />
        <Copy label="Stream key" value={live.obs.streamKey} secret />
        <p className="muted small">
          OBS → Settings → Output → Advanced: hardware encoder (QuickSync or NVENC), CBR 6000 Kbps, keyframe
          interval 1 s, B-frames 0. Video: 1920x1080, 30 fps.
        </p>
      </details>

      {hetzner && live.usage && (
        <p className="muted small">
          This month: {live.usage.hours} server hour{live.usage.hours === 1 ? '' : 's'}, about $
          {live.usage.costUsd.toFixed(2)}. The server deletes itself {live.limits.idleMinutes} minutes after
          the stream ends and never runs more than {live.limits.capHours} hours.
        </p>
      )}
    </section>
  );
}
