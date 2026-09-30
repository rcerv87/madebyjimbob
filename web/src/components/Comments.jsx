import { useEffect, useState } from 'react';
import { api, compact, count, timeAgo } from '../api.js';

// YouTube-style comments under the video: imported YouTube comments and native ones, one level of replies.
export default function Comments({ videoId, session }) {
  const [sort, setSort] = useState('top');
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [loadingMore, setLoadingMore] = useState(false);

  useEffect(() => {
    setData(null);
    setError('');
    api(`/videos/${videoId}/comments?sort=${sort}`)
      .then(setData)
      .catch((e) => setError(e.message));
  }, [videoId, sort]);

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

  const addReply = (parentId, reply) =>
    setData((d) => ({
      ...d,
      total: d.total + 1,
      comments: d.comments.map((c) => (c.id === parentId ? { ...c, replies: [...c.replies, reply] } : c)),
    }));

  if (error && !data) return <p className="error comments">Couldn’t load comments: {error}</p>;
  if (!data) return <p className="muted comments">Loading comments…</p>;

  return (
    <section className="comments" aria-label="Comments">
      <header className="comments-head">
        <h2>{count(data.total, 'comment')}</h2>
        <select value={sort} onChange={(e) => setSort(e.target.value)} aria-label="Sort comments">
          <option value="top">Top comments</option>
          <option value="new">Newest first</option>
        </select>
      </header>

      <CommentForm videoId={videoId} session={session} onPosted={addComment} placeholder="Add a comment…" />

      {data.comments.length === 0 && <p className="muted">No comments yet. Start the conversation.</p>}
      <ol className="comment-list">
        {data.comments.map((c) => (
          <CommentThread key={c.id} c={c} videoId={videoId} session={session} onReply={addReply} />
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

function CommentThread({ c, videoId, session, onReply }) {
  const [open, setOpen] = useState(false);
  const [replying, setReplying] = useState(false);
  const n = c.replies.length;

  return (
    <li className="comment-thread">
      <Comment c={c} onReplyClick={() => (session.user ? setReplying(true) : session.requireSignIn())} />
      <div className="comment-children">
        {replying && (
          <CommentForm
            videoId={videoId}
            session={session}
            parentId={c.id}
            placeholder={`Reply to ${c.author}…`}
            autoFocus
            onCancel={() => setReplying(false)}
            onPosted={(reply) => {
              onReply(c.id, reply);
              setReplying(false);
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
              <li key={r.id}>
                <Comment c={r} />
              </li>
            ))}
          </ol>
        )}
      </div>
    </li>
  );
}

function Comment({ c, onReplyClick }) {
  return (
    <article className="comment">
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
        </p>
        <p className="comment-body">{c.body}</p>
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

function CommentForm({ videoId, session, parentId, placeholder, autoFocus, onPosted, onCancel }) {
  const [text, setText] = useState('');
  const [active, setActive] = useState(!!autoFocus);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const cancel = () => {
    setText('');
    setActive(false);
    setError('');
    onCancel?.();
  };

  const submit = async (e) => {
    e.preventDefault();
    if (!session.user) return session.requireSignIn();
    if (!text.trim()) return setError('Write a comment first.');
    setBusy(true);
    try {
      const { comment } = await api(`/videos/${videoId}/comments`, {
        method: 'POST',
        body: { text, ...(parentId && { parentId }) },
      });
      onPosted(comment);
      setText('');
      setActive(false);
      setError('');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className={`comment-form ${parentId ? 'reply' : ''}`} onSubmit={submit}>
      <textarea
        value={text}
        rows={active ? 3 : 1}
        maxLength={2000}
        placeholder={session.user ? placeholder : 'Sign in to comment'}
        aria-label={placeholder}
        autoFocus={autoFocus}
        onFocus={() => (session.user ? setActive(true) : session.requireSignIn())}
        onChange={(e) => {
          setText(e.target.value);
          setError('');
        }}
      />
      {error && <p className="error small">{error}</p>}
      {active && (
        <div className="comment-form-actions">
          <button type="button" className="text-btn" onClick={cancel}>
            Cancel
          </button>
          <button className="primary-btn" disabled={busy || !text.trim()}>
            {busy ? 'Posting…' : parentId ? 'Reply' : 'Comment'}
          </button>
        </div>
      )}
    </form>
  );
}
