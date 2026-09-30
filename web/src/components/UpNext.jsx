import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { formatTime } from '../api.js';

const AUTOPLAY_KEY = 'mbjb_autoplay';

export function readAutoplay() {
  try {
    return localStorage.getItem(AUTOPLAY_KEY) !== 'off';
  } catch {
    return true;
  }
}

function saveAutoplay(on) {
  try {
    localStorage.setItem(AUTOPLAY_KEY, on ? 'on' : 'off');
  } catch {
    /* not remembered in private mode */
  }
}

// Beside the video: the playlist being played (with position), or the next video on the channel.
export default function UpNext({ queue, index, playlist, autoplay, onAutoplay, hrefFor }) {
  const [open, setOpen] = useState(true);
  const next = queue[index + 1];
  const toggle = (
    <label className="autoplay-toggle">
      <input
        id="autoplay-next"
        type="checkbox"
        checked={autoplay}
        onChange={(e) => {
          saveAutoplay(e.target.checked);
          onAutoplay(e.target.checked);
        }}
      />
      Autoplay
    </label>
  );

  if (playlist) {
    return (
      <section className="up-next playlist-panel" aria-label="Playlist">
        <header>
          <div>
            <Link to={`/playlist/${playlist.id}`} className="up-next-title">
              {playlist.title}
            </Link>
            <span className="muted small">
              {' '}
              · {index + 1} / {queue.length}
            </span>
          </div>
          <div className="up-next-actions">
            {toggle}
            <button
              type="button"
              className="text-btn"
              onClick={() => setOpen((o) => !o)}
              aria-expanded={open}
            >
              {open ? 'Hide' : 'Show'}
            </button>
          </div>
        </header>
        {open && (
          <ol className="up-next-list">
            {queue.map((v, i) => (
              <li key={v.id} className={i === index ? 'current' : ''}>
                <QueueItem v={v} n={i + 1} href={hrefFor(v)} current={i === index} />
              </li>
            ))}
          </ol>
        )}
      </section>
    );
  }

  if (!next) return null;
  return (
    <section className="up-next" aria-label="Up next">
      <header>
        <span className="up-next-title">Up next</span>
        {toggle}
      </header>
      <QueueItem v={next} href={hrefFor(next)} />
    </section>
  );
}

function QueueItem({ v, n, href, current }) {
  return (
    <Link to={href} className="queue-item" aria-current={current ? 'true' : undefined}>
      {n !== undefined && <span className="queue-n">{current ? '▶' : n}</span>}
      <span className="queue-thumb">
        {v.thumbnail ? <img src={v.thumbnail} alt="" loading="lazy" /> : null}
        {v.durationS ? <span className="duration">{formatTime(v.durationS)}</span> : null}
      </span>
      <span className="queue-title">{v.title}</span>
    </Link>
  );
}

// Over the finished video: count down, then play the next one unless cancelled.
export function EndScreen({ next, seconds = 5, onPlay, onCancel }) {
  const [left, setLeft] = useState(seconds);
  useEffect(() => {
    if (left <= 0) {
      onPlay();
      return;
    }
    const t = setTimeout(() => setLeft((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [left, onPlay]);
  return (
    <div className="end-screen" role="dialog" aria-label="Up next">
      <p className="muted small">Up next in {left}</p>
      <p className="end-title">{next.title}</p>
      <div className="end-actions">
        <button type="button" className="text-btn" onClick={onCancel}>
          Cancel
        </button>
        <button type="button" className="primary-btn" onClick={onPlay}>
          Play now
        </button>
      </div>
    </div>
  );
}
