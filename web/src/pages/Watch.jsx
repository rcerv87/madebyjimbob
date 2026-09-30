import { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api, compact, timeAgo, TIER_LABEL } from '../api.js';
import Player from '../components/Player.jsx';
import ChatPanel from '../components/ChatPanel.jsx';

export default function Watch({ session }) {
  const { id } = useParams();
  const [video, setVideo] = useState(null);
  const [error, setError] = useState('');
  const [timeMs, setTimeMs] = useState(0);
  const [expanded, setExpanded] = useState(false);
  const playerRef = useRef(null);

  useEffect(() => {
    setVideo(null);
    setError('');
    setTimeMs(0);
    api(`/videos/${id}`)
      .then((d) => setVideo(d.video))
      .catch((e) => setError(e.message));
    api(`/videos/${id}/view`, { method: 'POST' }).catch(() => {});
  }, [id, session.user?.tier]);

  if (error) return <p className="error page-msg">{error}</p>;
  if (!video) return <p className="muted page-msg">Loading…</p>;

  return (
    <div className="watch">
      <div className="watch-main">
        {video.locked ? (
          <div className="locked">
            <h2>{TIER_LABEL[video.minTier]} members only</h2>
            <p>This stream is part of the {TIER_LABEL[video.minTier]} tier.</p>
            {!session.user && (
              <button className="primary-btn" onClick={session.requireSignIn}>
                Sign in
              </button>
            )}
          </div>
        ) : (
          <Player
            src={video.hls}
            poster={video.thumbnail}
            title={video.title}
            playerRef={playerRef}
            onTime={(s) => setTimeMs(Math.floor(s * 1000))}
          />
        )}
        <h1 className="watch-title">{video.title}</h1>
        <div className={`description ${expanded ? 'open' : ''}`} onClick={() => setExpanded(true)}>
          <p className="desc-meta">
            {compact(video.views)} views · {timeAgo(video.publishedAt)} · {compact(video.chatCount)} chat
            messages
          </p>
          <p className="desc-text">{video.description || 'No description.'}</p>
          {!expanded && video.description?.length > 200 && <span className="more">Show more</span>}
        </div>
      </div>
      {!video.locked && (
        <ChatPanel
          videoId={video.id}
          timeMs={timeMs}
          getTimeMs={() => Math.floor((playerRef.current?.currentTime || 0) * 1000)}
          onSeek={(ms) => {
            if (playerRef.current) playerRef.current.currentTime = ms / 1000;
          }}
          session={session}
        />
      )}
    </div>
  );
}
