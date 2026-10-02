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
  starting: 'Starting server… (about 3 minutes)',
  ready: 'Server ready',
  stopping: 'Shutting down…',
};

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
            {SERVER_STATE[state] || state}
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
