import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api, count, formatTime, timeAgo, TIER_LABEL } from '../api.js';
import { createClock, useClock } from '../clock.js';
import { readLocal, resumePoint, saveProgress, viewerId } from '../progress.js';
import Player from '../components/Player.jsx';
import ChatPanel from '../components/ChatPanel.jsx';
import Comments from '../components/Comments.jsx';
import UpNext, { EndScreen, readAutoplay } from '../components/UpNext.jsx';
import ShareButton from '../components/ShareButton.jsx';
import LikeButtons from '../components/LikeButtons.jsx';
import useTitle from '../useTitle.js';

const SAVE_EVERY_MS = 10_000;

// The chat follows the playhead; it's the only part of the page that re-renders as the video plays.
function SyncedChat({ clock, ...props }) {
  return <ChatPanel timeMs={useClock(clock)} {...props} />;
}

// background: kept mounted (hidden) under another page while its video plays in the Mini player.
export default function Watch({ session, background = false }) {
  const { id } = useParams();
  const [params] = useSearchParams();
  const [video, setVideo] = useState(null);
  const [error, setError] = useState('');
  const [expanded, setExpanded] = useState(false);
  const [startMs, setStartMs] = useState(0);
  const [resumedFrom, setResumedFrom] = useState(null);
  const [focusThread, setFocusThread] = useState(null);
  const [clock] = useState(createClock);
  const playerRef = useRef(null);
  const loadedId = useRef(null);
  useTitle(video?.title || null, !background);
  const lastSave = useRef(0);
  const navigate = useNavigate();
  const location = useLocation();
  const listId = params.get('list');
  // Up next: the playlist being played (?list=), otherwise the channel, newest first.
  const [queue, setQueue] = useState({ items: [], playlist: null });
  const [autoplay, setAutoplay] = useState(readAutoplay);
  const [ending, setEnding] = useState(null);

  useEffect(() => {
    let cancelled = false;
    const load = listId
      ? api(`/playlists/${listId}`).then((d) => ({ items: d.videos, playlist: d.playlist }))
      : api('/videos').then((d) => ({ items: d.videos, playlist: null }));
    load
      .then((q) => !cancelled && setQueue(q))
      .catch(() => !cancelled && setQueue({ items: [], playlist: null }));
    return () => {
      cancelled = true;
    };
  }, [listId]);

  const index = queue.items.findIndex((v) => String(v.id) === String(id));
  const next = index >= 0 ? queue.items[index + 1] : null;
  const previous = index > 0 ? queue.items[index - 1] : null;
  const hrefFor = useCallback((v) => `/watch/${v.id}${listId ? `?list=${listId}` : ''}`, [listId]);
  // Keep Listen only on when moving to the next item.
  const go = useCallback(
    (v, listening = false) => {
      setEnding(null);
      navigate(hrefFor(v), { state: { listen: listening } });
    },
    [navigate, hrefFor],
  );
  // Never pull the viewer off the page they're browsing to start the next video.
  const onEnded = (listening) => {
    if (autoplay && next && !background) setEnding({ next, listening });
  };
  const playNext = useCallback(() => ending && go(ending.next, ending.listening), [ending, go]);

  // One view per video opened, not another when the viewer signs in or out.
  useEffect(() => {
    api(`/videos/${id}/view`, { method: 'POST', body: { viewer: viewerId() } }).catch(() => {});
  }, [id]);

  // A different video starts fresh. Signing in or out reloads this one in place, so a members video can
  // unlock (and likes show your vote) without restarting what's playing. Late answers for an earlier
  // video or session are dropped.
  const tier = session.user?.tier;
  useEffect(() => {
    let cancelled = false;
    const fresh = loadedId.current !== id;
    if (fresh) {
      loadedId.current = null;
      setVideo(null);
      setError('');
      setExpanded(false);
      setFocusThread(null);
      setResumedFrom(null);
      setEnding(null);
      clock.set(0);
    }
    api(`/videos/${id}`)
      .then((d) => {
        if (cancelled) return;
        if (fresh) {
          // ?t=<seconds> (shared links, notifications) wins; otherwise resume where they left off.
          const t = Number(params.get('t'));
          if (Number.isFinite(t) && t > 0) {
            setStartMs(t * 1000);
          } else {
            const resume = resumePoint(d.video.resumeMs ?? readLocal(id), d.video.durationS);
            setStartMs(resume || 0);
            setResumedFrom(resume);
          }
        }
        loadedId.current = id;
        setVideo(d.video);
      })
      .catch((e) => {
        if (!cancelled && fresh) setError(e.message);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- ?t is read once per video, not on every change
  }, [id, tier, clock]);

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
  const shownId = video?.id;
  useEffect(() => {
    const t = Number(tParam);
    if (shownId && Number.isFinite(t) && t > 0 && playerRef.current) playerRef.current.currentTime = t;
  }, [tParam, shownId]);
  useEffect(() => {
    if (shownId && commentParam) setFocusThread(commentParam);
  }, [commentParam, shownId]);

  const onTime = useCallback(
    (s) => {
      clock.set(Math.floor(s * 1000));
      if (Date.now() - lastSave.current > SAVE_EVERY_MS && s > 0) {
        lastSave.current = Date.now();
        saveProgress(id, s * 1000);
      }
    },
    [clock, id],
  );

  const seek = useCallback((ms) => {
    if (playerRef.current) playerRef.current.currentTime = ms / 1000;
  }, []);
  const getTimeMs = useCallback(() => Math.floor((playerRef.current?.currentTime || 0) * 1000), []);
  const closeThread = useCallback(() => setFocusThread(null), []);

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
          <div className="player-wrap">
            <Player
              key={video.id}
              src={video.hls}
              poster={video.thumbnail}
              title={video.title}
              startMs={startMs}
              startInListen={Boolean(location.state?.listen)}
              playerRef={playerRef}
              onTime={onTime}
              onEnded={onEnded}
              onNext={next ? (listening) => go(next, listening) : undefined}
              onPrevious={previous ? (listening) => go(previous, listening) : undefined}
            />
            {ending && <EndScreen next={ending.next} onPlay={playNext} onCancel={() => setEnding(null)} />}
          </div>
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
        <div className="watch-head">
          <h1 className="watch-title">{video.title}</h1>
          <div className="watch-actions">
            {!video.locked && (
              <LikeButtons videoId={video.id} likes={video.likes} myVote={video.myVote} session={session} />
            )}
            <ShareButton title={video.title} path={`/watch/${video.id}`} getTimeMs={getTimeMs} />
          </div>
        </div>
        <div className={`description ${expanded ? 'open' : ''}`} onClick={() => setExpanded(true)}>
          <p className="desc-meta">
            {count(video.views, 'view')} · {timeAgo(video.publishedAt)} ·{' '}
            {count(video.chatCount, 'chat message')}
          </p>
          <p className="desc-text">{video.description || 'No description.'}</p>
          {!expanded && video.description?.length > 200 && <span className="more">Show more</span>}
        </div>
        {index >= 0 && (
          <UpNext
            queue={queue.items}
            index={index}
            playlist={queue.playlist}
            autoplay={autoplay}
            onAutoplay={setAutoplay}
            hrefFor={hrefFor}
          />
        )}
      </div>
      {!video.locked && (
        <SyncedChat
          clock={clock}
          videoId={video.id}
          getTimeMs={getTimeMs}
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
            getTimeMs={getTimeMs}
            onSeek={seek}
            focusThreadId={focusThread}
            onCloseFocus={closeThread}
          />
        </div>
      )}
    </div>
  );
}
