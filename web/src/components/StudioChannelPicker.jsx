import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, formatTime, timeAgo } from '../api.js';

const JIMBOB = 'https://www.youtube.com/@madebyjimbob';
const KIND_LABEL = { video: 'Video', live: 'Stream', short: 'Short' };
const PAGE = 100;

// Studio → Add videos → From the channel (MBJ-706): every video on a channel, marked on the site / queued / new,
// with check boxes to queue the new ones in one go.
export default function StudioChannelPicker({ tier, withComments, onQueued }) {
  const [url, setUrl] = useState(JIMBOB);
  const [loadedUrl, setLoadedUrl] = useState(JIMBOB);
  const [show, setShow] = useState('new');
  const [kind, setKind] = useState('all');
  const [q, setQ] = useState('');
  const [query, setQuery] = useState('');
  const [data, setData] = useState(null);
  const [videos, setVideos] = useState([]);
  const [picked, setPicked] = useState(() => new Map()); // youtubeId -> video
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const request = useRef(0);

  // Search as you type, a moment after typing stops.
  useEffect(() => {
    const t = setTimeout(() => setQuery(q.trim()), 300);
    return () => clearTimeout(t);
  }, [q]);

  const fetchPage = useCallback(
    async (offset = 0) => {
      const mine = (request.current += 1);
      const params = new URLSearchParams({ url: loadedUrl, show, kind, q: query, offset, limit: PAGE });
      const d = await api(`/studio/channel?${params}`);
      if (mine !== request.current) return; // a newer filter won
      setData(d);
      setVideos((prev) => (offset ? [...prev, ...d.videos] : d.videos));
    },
    [loadedUrl, show, kind, query],
  );

  useEffect(() => {
    setError('');
    fetchPage(0).catch((e) => setError(e.message));
  }, [fetchPage]);

  // While the list is being made, check every few seconds.
  const waiting = data?.listing && ['queued', 'running'].includes(data.listing.status);
  useEffect(() => {
    if (!waiting) return undefined;
    const t = setInterval(() => fetchPage(0).catch(() => {}), 4000);
    return () => clearInterval(t);
  }, [waiting, fetchPage]);

  const refresh = async () => {
    setError('');
    try {
      await api('/studio/channel/refresh', { method: 'POST', body: { url: loadedUrl } });
      await fetchPage(0);
    } catch (err) {
      setError(err.message);
    }
  };

  const load = (e) => {
    e.preventDefault();
    setPicked(new Map());
    setNote('');
    setLoadedUrl(url.trim() || JIMBOB);
  };

  const toggle = (v) =>
    setPicked((prev) => {
      const next = new Map(prev);
      if (next.has(v.youtubeId)) next.delete(v.youtubeId);
      else next.set(v.youtubeId, v);
      return next;
    });
  const selectable = videos.filter((v) => v.state === 'new');
  const allPicked = selectable.length > 0 && selectable.every((v) => picked.has(v.youtubeId));
  const toggleAll = () =>
    setPicked((prev) => {
      const next = new Map(prev);
      for (const v of selectable) {
        if (allPicked) next.delete(v.youtubeId);
        else next.set(v.youtubeId, v);
      }
      return next;
    });

  const queue = async () => {
    setError('');
    setNote('');
    setBusy(true);
    try {
      const r = await api('/studio/imports', {
        method: 'POST',
        body: { urls: [...picked.keys()], tier, withComments },
      });
      setNote(
        `${r.queued.length} video${r.queued.length === 1 ? '' : 's'} added to the import queue.` +
          (r.skipped.length ? ` Skipped ${r.skipped.length} already on the site or queued.` : ''),
      );
      setPicked(new Map());
      onQueued?.();
      await fetchPage(0);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const listing = data?.listing;
  const counts = data?.counts;
  const membersPicked = [...picked.values()].filter((v) => v.availability === 'subscriber_only').length;

  return (
    <div className="channel-picker">
      <form className="channel-load" onSubmit={load}>
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          aria-label="YouTube channel link"
          placeholder="https://www.youtube.com/@channel"
        />
        <button className="text-btn">Show this channel</button>
      </form>

      <ListingStatus listing={listing} apiKey={data?.apiKey} helper={data?.helper} onRefresh={refresh} />

      {counts?.all > 0 && (
        <>
          <div className="channel-filters">
            <div className="chips" role="group" aria-label="Which videos">
              <button
                type="button"
                className={`chip ${show === 'new' ? 'active' : ''}`}
                aria-pressed={show === 'new'}
                onClick={() => setShow('new')}
              >
                Not imported <span>{counts.new}</span>
              </button>
              <button
                type="button"
                className={`chip ${show === 'all' ? 'active' : ''}`}
                aria-pressed={show === 'all'}
                onClick={() => setShow('all')}
              >
                All <span>{counts.all}</span>
              </button>
            </div>
            <select value={kind} onChange={(e) => setKind(e.target.value)} aria-label="Type">
              <option value="all">All types</option>
              <option value="video">Videos</option>
              <option value="live">Streams</option>
              <option value="short">Shorts</option>
            </select>
            <input
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search titles"
              aria-label="Search titles"
            />
          </div>

          <div className="channel-list-head">
            <label className="check">
              <input type="checkbox" checked={allPicked} onChange={toggleAll} disabled={!selectable.length} />
              Select all shown ({selectable.length})
            </label>
            <span className="muted small">
              {counts.onsite} on the site · {counts.queued} queued · {data.total} shown
            </span>
          </div>

          <ul className="channel-list">
            {videos.map((v) => (
              <li key={v.youtubeId} className={v.state !== 'new' ? 'done' : ''}>
                <input
                  type="checkbox"
                  checked={picked.has(v.youtubeId)}
                  disabled={v.state !== 'new'}
                  onChange={() => toggle(v)}
                  aria-label={`Import ${v.title}`}
                />
                <img src={v.thumbnail} alt="" loading="lazy" width="120" height="68" />
                <div className="channel-item">
                  <a href={`https://www.youtube.com/watch?v=${v.youtubeId}`} target="_blank" rel="noreferrer">
                    {v.title || v.youtubeId}
                  </a>
                  <span className="muted small">
                    {[
                      KIND_LABEL[v.kind],
                      v.publishedAt && timeAgo(v.publishedAt),
                      v.durationS && formatTime(v.durationS),
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                  <span>
                    {v.state === 'onsite' && (
                      <Link className="badge ok" to={`/watch/${v.videoId}`}>
                        On the site
                      </Link>
                    )}
                    {v.state === 'queued' && <span className="badge">Queued</span>}
                    {v.availability === 'subscriber_only' && (
                      <span className="badge">Members only on YouTube</span>
                    )}
                  </span>
                </div>
              </li>
            ))}
          </ul>
          {videos.length < data.total && (
            <button
              className="text-btn"
              onClick={() => fetchPage(videos.length).catch((e) => setError(e.message))}
            >
              Show more ({data.total - videos.length} left)
            </button>
          )}
          {!videos.length && (
            <p className="muted small">
              {show === 'new' ? 'Everything here is imported or queued.' : 'Nothing matches.'}
            </p>
          )}
        </>
      )}

      <div className="channel-queue">
        <button className="primary-btn" disabled={!picked.size || busy} onClick={queue}>
          {busy ? 'Adding…' : `Queue ${picked.size} video${picked.size === 1 ? '' : 's'}`}
        </button>
        {membersPicked > 0 && (
          <span className="small muted">
            {membersPicked} of these {membersPicked === 1 ? 'is' : 'are'} members-only on YouTube; importing
            them may fail unless yt-dlp can sign in as a member.
          </span>
        )}
      </div>
      {note && (
        <p className="small" role="status">
          {note}
        </p>
      )}
      {error && <p className="error small">{error}</p>}
    </div>
  );
}

function ListingStatus({ listing, apiKey, helper, onRefresh }) {
  if (!listing) {
    return (
      <p className="small">
        No list for this channel yet.{' '}
        <button className="text-btn" onClick={onRefresh}>
          Get the list of videos
        </button>
        {!apiKey && <HelperHint helper={helper} />}
      </p>
    );
  }
  if (listing.status === 'queued' || listing.status === 'running') {
    return (
      <p className="small" role="status">
        {listing.status === 'running'
          ? 'Making the list…'
          : 'Waiting for the helper on your PC to list the channel…'}
        {listing.source === 'helper' && <HelperHint helper={helper} />}
      </p>
    );
  }
  if (listing.status === 'failed') {
    return (
      <p className="small error">
        Couldn’t list the channel: {listing.error}{' '}
        <button className="text-btn" onClick={onRefresh}>
          Try again
        </button>
      </p>
    );
  }
  return (
    <p className="small muted">
      {listing.videoCount} videos, listed {timeAgo(listing.finishedAt).toLowerCase()}.{' '}
      <button className="text-btn" onClick={onRefresh}>
        Refresh the list
      </button>
    </p>
  );
}

function HelperHint({ helper }) {
  if (helper?.online) return null;
  return (
    <span className="muted">
      {' '}
      The helper isn’t running: start it with <code>npm run import:worker</code>.
    </span>
  );
}
