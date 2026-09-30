import { useEffect, useRef, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { api, count, formatTime, timeAgo, TIER_LABEL } from '../api.js';
import { readLocal, resumePoint, saveProgress } from '../progress.js';
import Player from '../components/Player.jsx';
import ChatPanel from '../components/ChatPanel.jsx';
import Comments from '../components/Comments.jsx';

const SAVE_EVERY_MS = 10_000;

export default function Watch({ session }) {
  const { id } = useParams();
  const [params] = useSearchParams();
  const [video, setVideo] = useState(null);
  const [error, setError] = useState('');
  const [timeMs, setTimeMs] = useState(0);
  const [expanded, setExpanded] = useState(false);
  const [startMs, setStartMs] = useState(0);
  const [resumedFrom, setResumedFrom] = useState(null);
  const [focusThread, setFocusThread] = useState(null);
  const playerRef = useRef(null);
  const lastSave = useRef(0);

  useEffect(() => {
    setVideo(null);
    setError('');
    setTimeMs(0);
    setFocusThread(null);
    setResumedFrom(null);
    api(`/videos/${id}`)
      .then((d) => {
        // ?t=<seconds> (shared links, notifications) wins; otherwise resume where they left off.
        const t = Number(params.get('t'));
        if (Number.isFinite(t) && t > 0) {
          setStartMs(t * 1000);
        } else {
          const resume = resumePoint(d.video.resumeMs ?? readLocal(id), d.video.durationS);
          setStartMs(resume || 0);
          setResumedFrom(resume);
        }
        setVideo(d.video);
      })
      .catch((e) => setError(e.message));
    api(`/videos/${id}/view`, { method: 'POST' }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps -- ?t is read once per video, not on every change
  }, [id, session.user?.tier]);

  // Save the position every few seconds while watching, and right away when leaving the page.
  useEffect(() => {
    const saveNow = () => {
      const v = playerRef.current;
      if (v && v.currentTime > 0) saveProgress(id, v.currentTime * 1000);
    };
    const onHide = () => document.visibilityState === 'hidden' && saveNow();
    window.addEventListener('pagehide', saveNow);
    document.addEventListener('visibilitychange', onHide);
    return () => {
      saveNow();
      window.removeEventListener('pagehide', saveNow);
      document.removeEventListener('visibilitychange', onHide);
    };
  }, [id]);

  // Opening a notification while already on this video: jump to the moment / open the thread.
  const tParam = params.get('t');
  const commentParam = params.get('comment');
  useEffect(() => {
    const t = Number(tParam);
    if (video && Number.isFinite(t) && t > 0 && playerRef.current) playerRef.current.currentTime = t;
  }, [tParam, video]);
  useEffect(() => {
    if (video && commentParam) setFocusThread(commentParam);
  }, [commentParam, video]);

  const onTime = (s) => {
    setTimeMs(Math.floor(s * 1000));
    if (Date.now() - lastSave.current > SAVE_EVERY_MS && s > 0) {
      lastSave.current = Date.now();
      saveProgress(id, s * 1000);
    }
  };

  const seek = (ms) => {
    if (playerRef.current) playerRef.current.currentTime = ms / 1000;
  };

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
            startMs={startMs}
            playerRef={playerRef}
            onTime={onTime}
          />
        )}
        {resumedFrom !== null && !video.locked && (
          <p className="resume-note">
            Resumed from {formatTime(resumedFrom / 1000)} ·{' '}
            <button
              type="button"
              className="text-btn"
              onClick={() => {
                seek(0);
                setResumedFrom(null);
              }}
            >
              Start over
            </button>
          </p>
        )}
        <h1 className="watch-title">{video.title}</h1>
        <div className={`description ${expanded ? 'open' : ''}`} onClick={() => setExpanded(true)}>
          <p className="desc-meta">
            {count(video.views, 'view')} · {timeAgo(video.publishedAt)} ·{' '}
            {count(video.chatCount, 'chat message')}
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
          onSeek={seek}
          onOpenThread={setFocusThread}
          session={session}
        />
      )}
      {!video.locked && (
        <div className="watch-comments">
          <Comments
            videoId={video.id}
            session={session}
            getTimeMs={() => Math.floor((playerRef.current?.currentTime || 0) * 1000)}
            onSeek={seek}
            focusThreadId={focusThread}
            onCloseFocus={() => setFocusThread(null)}
          />
        </div>
      )}
    </div>
  );
}
