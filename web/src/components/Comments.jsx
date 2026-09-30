import { useEffect, useRef, useState } from 'react';
import { api, compact, count, formatTime, splitTimestamps, timeAgo } from '../api.js';

// YouTube-style comments under the video: imported YouTube comments and native ones, one level of
// threads. Every reply records the exact comment it answers and quotes it, so long threads keep
// their context. Comments can carry a moment in the video, which also puts them in the chat feed.
export default function Comments({ videoId, session, getTimeMs, onSeek, focusThreadId, onCloseFocus }) {
  const [sort, setSort] = useState('top');
  const [data, setData] = useState(null);
  const [focus, setFocus] = useState(null);
  const [error, setError] = useState('');
  const [loadingMore, setLoadingMore] = useState(false);
  const focusRef = useRef(null);

  useEffect(() => {
    setData(null);
    setError('');
    api(`/videos/${videoId}/comments?sort=${sort}`)
      .then(setData)
      .catch((e) => setError(e.message));
  }, [videoId, sort]);

  // Opened from a comment bubble in the chat: load that whole thread and show it at the top.
  useEffect(() => {
    if (!focusThreadId) return setFocus(null);
    api(`/videos/${videoId}/comments/${focusThreadId}`)
      .then((d) => {
        setFocus(d.comment);
        requestAnimationFrame(() => focusRef.current?.scrollIntoView({ block: 'start', behavior: 'smooth' }));
      })
      .catch((e) => setError(e.message));
  }, [videoId, focusThreadId]);

  const loadMore = async () => {
    setLoadingMore(true);
    try {
      const next = await api(`/videos/${videoId}/comments?sort=${sort}&offset=${data.nextOffset}`);
      setData((d) => ({ ...next, comments: [...d.comments, ...next.comments] }));
    } catch (e) {
      setError(e.message);
    } finally {
      setLoadingMore(false);
    }
  };

  const addComment = (comment) =>
    setData((d) => ({ ...d, total: d.total + 1, comments: [comment, ...d.comments] }));

  const addReply = (threadId, reply) => {
    const withReply = (c) => (c.id === threadId ? { ...c, replies: [...c.replies, reply] } : c);
    setData((d) => ({ ...d, total: d.total + 1, comments: d.comments.map(withReply) }));
    setFocus((f) => (f ? withReply(f) : f));
  };

  if (error && !data) return <p className="error comments">Couldn’t load comments: {error}</p>;
  if (!data) return <p className="muted comments">Loading comments…</p>;

  const shared = { videoId, session, getTimeMs, onSeek, onReply: addReply };

  return (
    <section className="comments" aria-label="Comments">
      <header className="comments-head">
        <h2>{count(data.total, 'comment')}</h2>
        <select value={sort} onChange={(e) => setSort(e.target.value)} aria-label="Sort comments">
          <option value="top">Top comments</option>
          <option value="new">Newest first</option>
        </select>
      </header>

      <CommentForm {...shared} onPosted={addComment} placeholder="Add a comment…" />

      {focus && (
        <div className="comment-focus" ref={focusRef}>
          <div className="comment-focus-head">
            <span>Thread from the chat</span>
            <button type="button" className="text-btn" onClick={onCloseFocus}>
              Close
            </button>
          </div>
          <ol className="comment-list">
            <CommentThread key={`focus-${focus.id}`} c={focus} startOpen {...shared} />
          </ol>
        </div>
      )}

      {data.comments.length === 0 && <p className="muted">No comments yet. Start the conversation.</p>}
      <ol className="comment-list">
        {data.comments
          .filter((c) => c.id !== focus?.id)
          .map((c) => (
            <CommentThread key={c.id} c={c} {...shared} />
          ))}
      </ol>

      {error && <p className="error small">{error}</p>}
      {data.nextOffset !== null && (
        <button type="button" className="text-btn more-comments" onClick={loadMore} disabled={loadingMore}>
          {loadingMore ? 'Loading…' : 'Show more comments'}
        </button>
      )}
    </section>
  );
}

function CommentThread({ c, videoId, session, getTimeMs, onSeek, onReply, startOpen = false }) {
  const [open, setOpen] = useState(startOpen);
  const [replyTarget, setReplyTarget] = useState(null);
  const [flashId, setFlashId] = useState(null);
  const listRef = useRef(null);
  const n = c.replies.length;

  const reply = (target) => (session.user ? setReplyTarget(target) : session.requireSignIn());

  // A quote inside the thread points at another comment in it: open the replies and flash it.
  const showOriginal = (quote) => {
    setOpen(true);
    requestAnimationFrame(() => {
      const el =
        quote.id === c.id
          ? listRef.current?.closest('.comment-thread')
          : listRef.current?.querySelector(`[data-comment="${quote.id}"]`);
      el?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      setFlashId(quote.id);
      setTimeout(() => setFlashId(null), 1600);
    });
  };

  const common = { onSeek, onQuote: showOriginal };

  return (
    <li className="comment-thread">
      <Comment c={c} flash={flashId === c.id} onReplyClick={() => reply(c)} {...common} />
      <div className="comment-children" ref={listRef}>
        {replyTarget && (
          <CommentForm
            videoId={videoId}
            session={session}
            getTimeMs={getTimeMs}
            replyTarget={replyTarget}
            placeholder={`Reply to ${replyTarget.author}…`}
            autoFocus
            onCancel={() => setReplyTarget(null)}
            onPosted={(posted) => {
              onReply(c.id, posted);
              setReplyTarget(null);
              setOpen(true);
            }}
          />
        )}
        {n > 0 && (
          <button
            type="button"
            className="replies-toggle"
            onClick={() => setOpen((o) => !o)}
            aria-expanded={open}
          >
            {open ? 'Hide replies' : count(n, 'reply', 'replies')}
          </button>
        )}
        {open && (
          <ol className="comment-list replies">
            {c.replies.map((r) => (
              <li key={r.id} data-comment={r.id}>
                <Comment
                  c={r}
                  // A direct reply to the thread's first comment needs no quote; replies to replies do.
                  quote={r.replyTo && r.replyTo.id !== c.id ? r.replyTo : null}
                  flash={flashId === r.id}
                  onReplyClick={() => reply(r)}
                  {...common}
                />
              </li>
            ))}
          </ol>
        )}
      </div>
    </li>
  );
}

// Comment text with typed timestamps turned into buttons that seek the video.
function Body({ text, onSeek }) {
  return (
    <p className="comment-body">
      {splitTimestamps(text).map((part, i) =>
        part.ms === undefined ? (
          part.text
        ) : (
          <button key={i} type="button" className="inline-ts" onClick={() => onSeek?.(part.ms)}>
            {part.text}
          </button>
        ),
      )}
    </p>
  );
}

function Comment({ c, quote, flash, onReplyClick, onSeek, onQuote }) {
  return (
    <article className={`comment ${flash ? 'flash' : ''}`}>
      {c.authorPhoto ? (
        <img
          className="comment-avatar"
          src={c.authorPhoto}
          alt=""
          loading="lazy"
          referrerPolicy="no-referrer"
        />
      ) : (
        <span className="comment-avatar initial">{c.author.replace(/^@/, '')[0]?.toUpperCase()}</span>
      )}
      <div className="comment-main">
        {c.pinned && <p className="comment-pinned">Pinned by JimBob</p>}
        <p className="comment-meta">
          <span className={`comment-author ${c.isCreator ? 'creator' : ''}`}>{c.author}</span>
          {c.isCreator && <span className="creator-badge">Creator</span>}
          <span className={`source-tag ${c.source}`}>{c.source === 'youtube' ? 'YT' : 'JB'}</span>
          <span className="muted small">{timeAgo(c.postedAt)}</span>
          {c.offsetMs !== null && c.offsetMs !== undefined && (
            <button
              type="button"
              className="time-chip"
              onClick={() => onSeek?.(c.offsetMs)}
              title="Play from this moment"
            >
              at {formatTime(c.offsetMs / 1000)}
            </button>
          )}
        </p>
        {quote && (
          <button type="button" className="quote" onClick={() => onQuote?.(quote)} title="Show that comment">
            <span aria-hidden="true">↪</span> <b>{quote.author}</b> {quote.body}
          </button>
        )}
        <Body text={c.body} onSeek={onSeek} />
        <div className="comment-actions">
          {c.likes > 0 && (
            <span className="comment-likes" title="Likes on YouTube">
              <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true">
                <path
                  d="M7 10v11H3V10zm2 11V10l4.5-8 1.2.6a2 2 0 0 1 1 2.3L14.8 9H20a2 2 0 0 1 2 2.3l-1.4 8A2 2 0 0 1 18.6 21z"
                  fill="currentColor"
                />
              </svg>
              {compact(c.likes)}
            </span>
          )}
          {onReplyClick && (
            <button type="button" className="text-btn reply-btn" onClick={onReplyClick}>
              Reply
            </button>
          )}
        </div>
      </div>
    </article>
  );
}

function CommentForm({
  videoId,
  session,
  getTimeMs,
  replyTarget,
  placeholder,
  autoFocus,
  onPosted,
  onCancel,
}) {
  const mention = replyTarget ? `@${replyTarget.author.replace(/^@/, '')} ` : '';
  const [text, setText] = useState(mention);
  const [active, setActive] = useState(!!autoFocus);
  const [stampMs, setStampMs] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const cancel = () => {
    setText('');
    setActive(false);
    setStampMs(null);
    setError('');
    onCancel?.();
  };

  const submit = async (e) => {
    e.preventDefault();
    if (!session.user) return session.requireSignIn();
    if (!text.trim() || text.trim() === mention.trim()) return setError('Write a comment first.');
    setBusy(true);
    try {
      const { comment } = await api(`/videos/${videoId}/comments`, {
        method: 'POST',
        body: {
          text,
          ...(replyTarget && { replyToId: replyTarget.id }),
          ...(stampMs !== null && { offsetMs: stampMs }),
        },
      });
      onPosted(comment);
      setText('');
      setActive(false);
      setStampMs(null);
      setError('');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const canStamp = typeof getTimeMs === 'function';

  return (
    <form className={`comment-form ${replyTarget ? 'reply' : ''}`} onSubmit={submit}>
      {replyTarget && (
        <p className="quote static">
          <span aria-hidden="true">↪</span> <b>{replyTarget.author}</b> {replyTarget.body.slice(0, 140)}
        </p>
      )}
      <textarea
        value={text}
        rows={active ? 3 : 1}
        maxLength={2000}
        placeholder={session.user ? placeholder : 'Sign in to comment'}
        aria-label={placeholder}
        autoFocus={autoFocus}
        onFocus={(e) => {
          if (!session.user) return session.requireSignIn();
          setActive(true);
          const end = e.target.value.length;
          e.target.setSelectionRange(end, end);
        }}
        onChange={(e) => {
          setText(e.target.value);
          setError('');
        }}
      />
      {error && <p className="error small">{error}</p>}
      {active && (
        <div className="comment-form-actions">
          {canStamp &&
            (stampMs === null ? (
              <button
                type="button"
                className="time-chip add"
                onClick={() => setStampMs(Math.floor(getTimeMs()))}
                title="Attach this moment; the comment also shows in the chat at that time"
              >
                + Add {formatTime(getTimeMs() / 1000)}
              </button>
            ) : (
              <button
                type="button"
                className="time-chip on"
                onClick={() => setStampMs(null)}
                aria-label={`Remove timestamp ${formatTime(stampMs / 1000)}`}
              >
                at {formatTime(stampMs / 1000)} ×
              </button>
            ))}
          <span className="spacer" />
          <button type="button" className="text-btn" onClick={cancel}>
            Cancel
          </button>
          <button className="primary-btn" disabled={busy || !text.trim()}>
            {busy ? 'Posting…' : replyTarget ? 'Reply' : 'Comment'}
          </button>
        </div>
      )}
    </form>
  );
}
