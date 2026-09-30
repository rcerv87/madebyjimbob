import { Link } from 'react-router-dom';
import { formatTime, timeAgo, compact, TIER_LABEL } from '../api.js';

export default function VideoCard({ v }) {
  return (
    <Link to={`/watch/${v.id}`} className="card">
      <div className="thumb">
        {v.thumbnail ? (
          <img src={v.thumbnail} alt="" loading="lazy" />
        ) : (
          <div className="thumb-empty">Processing</div>
        )}
        {v.durationS ? <span className="duration">{formatTime(v.durationS)}</span> : null}
        {v.minTier !== 'free' && (
          <span className={`tier-pill tier-${v.minTier} on-thumb`}>{TIER_LABEL[v.minTier]}</span>
        )}
      </div>
      <div className="card-body">
        <h3>{v.title}</h3>
        <p className="muted">
          {compact(v.views)} views · {timeAgo(v.publishedAt)}
        </p>
        <p className="muted small">{compact(v.chatCount)} chat messages</p>
      </div>
    </Link>
  );
}
