import { useState } from 'react';
import { Link } from 'react-router-dom';
import { formatTime, timeAgo, count, TIER_LABEL } from '../api.js';
import { readLocal } from '../progress.js';

const KIND_LABEL = { short: 'Short', live: 'Streamed' };

// `to` overrides the link (e.g. to play inside a playlist); `position` numbers playlist items.
export default function VideoCard({ v, to, position }) {
  // How far they got: from their account when signed in, otherwise this browser.
  // A live replay recorded before thumbnails existed has none: show the empty tile instead of a broken image.
  const [noThumb, setNoThumb] = useState(false);
  const watchedMs = v.progressMs ?? readLocal(v.id);
  const watched = watchedMs > 10_000 && v.durationS ? Math.min(1, watchedMs / (v.durationS * 1000)) : null;
  return (
    <Link to={to || `/watch/${v.id}`} className="card">
      <div className="thumb">
        {v.thumbnail && !noThumb ? (
          <img src={v.thumbnail} alt="" loading="lazy" onError={() => setNoThumb(true)} />
        ) : (
          <div className="thumb-empty">{noThumb ? 'No preview' : 'Processing'}</div>
        )}
        {position && <span className="position">{position}</span>}
        {v.durationS ? <span className="duration">{formatTime(v.durationS)}</span> : null}
        {watched !== null && (
          <span
            className="card-progress"
            role="progressbar"
            aria-label="Watched"
            aria-valuenow={Math.round(watched * 100)}
            aria-valuemin={0}
            aria-valuemax={100}
          >
            <span style={{ width: `${watched * 100}%` }} />
          </span>
        )}
        {v.minTier !== 'free' && (
          <span className={`tier-pill tier-${v.minTier} on-thumb`}>{TIER_LABEL[v.minTier]}</span>
        )}
      </div>
      <div className="card-body">
        <h3>{v.title}</h3>
        <p className="muted">
          {KIND_LABEL[v.kind] && <span className="kind-tag">{KIND_LABEL[v.kind]}</span>}
          {count(v.views, 'view')} · {timeAgo(v.publishedAt)}
        </p>
        <p className="muted small">{count(v.chatCount, 'chat message')}</p>
      </div>
    </Link>
  );
}
