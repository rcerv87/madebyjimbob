import { useEffect, useMemo, useRef, useState } from 'react';
import { api, formatTime, getToken } from '../api.js';

const WINDOW_MS = 120_000;
const VISIBLE = 150;
const VIEW_KEY = 'mbjb_chat_view';
// Same rule as MENTION_RE in server/src/moderation.js, with the whole @name captured for split().
const MENTION_SPLIT = /((?<![A-Za-z0-9_])@[A-Za-z0-9_][A-Za-z0-9_.-]{1,30}[A-Za-z0-9_])/g;

const handle = (author) => author.replace(/^@/, '');
const readView = () => {
  try {
    return localStorage.getItem(VIEW_KEY) === 'all' ? 'all' : 'live';
  } catch {
    return 'live';
  }
};

// Chat beside the video. "Live only" shows the stream's original chat exactly as it happened;
// "Live + replay" adds messages people posted while watching later and timestamped comments,
// each at its moment in the video.
export default function ChatPanel({ videoId, timeMs, getTimeMs, onSeek, onOpenThread, session }) {
  const [byId, setById] = useState(() => new Map());
  const [commentsById, setCommentsById] = useState(() => new Map());
  const [view, setView] = useState(readView);
  const loaded = useRef(new Set());
  const listRef = useRef(null);
  const inputRef = useRef(null);
  const pinned = useRef(true);
  const lastId = useRef(0);
  const [showJump, setShowJump] = useState(false);
  const [text, setText] = useState('');
  const [replyTarget, setReplyTarget] = useState(null);
  const [flashId, setFlashId] = useState(null);
  const [suggest, setSuggest] = useState({ items: [], index: 0 });
  const [error, setError] = useState('');
  const [sending, setSending] = useState(false);

  const addMessages = (msgs) => {
    for (const m of msgs) lastId.current = Math.max(lastId.current, Number(m.id));
    setById((prev) => {
      const next = new Map(prev);
      for (const m of msgs) next.set(m.id, m);
      return next;
    });
  };

  const addComments = (list) =>
    setCommentsById((prev) => {
      const next = new Map(prev);
      for (const c of list) if (c.offsetMs !== null && c.offsetMs !== undefined) next.set(c.id, c);
      return next;
    });

  const changeView = (v) => {
    setView(v);
    try {
      localStorage.setItem(VIEW_KEY, v);
    } catch {
      /* private mode: the choice just isn't remembered */
    }
  };

  // Reset when switching videos
  useEffect(() => {
    setById(new Map());
    setCommentsById(new Map());
    loaded.current = new Set();
    lastId.current = 0;
    setReplyTarget(null);
  }, [videoId]);

  // Load the current and next 2-minute windows as playback moves
  const windowIdx = Math.floor(timeMs / WINDOW_MS);
  useEffect(() => {
    for (const idx of [windowIdx, windowIdx + 1]) {
      if (loaded.current.has(idx)) continue;
      loaded.current.add(idx);
      api(`/videos/${videoId}/chat?from=${idx * WINDOW_MS}&to=${(idx + 1) * WINDOW_MS}`)
        .then((d) => {
          addMessages(d.messages);
          addComments(d.comments || []);
        })
        .catch(() => loaded.current.delete(idx));
    }
  }, [videoId, windowIdx]);

  // Realtime: messages and timestamped comments other viewers post while watching
  useEffect(() => {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    let ws;
    let retry;
    let reconnecting = false;
    const connect = () => {
      ws = new WebSocket(`${proto}://${location.host}/ws`);
      ws.onopen = () => {
        ws.send(JSON.stringify({ type: 'join', videoId, token: getToken() }));
        // Catch up on anything posted while the socket was down.
        if (reconnecting && lastId.current) {
          api(`/videos/${videoId}/chat?afterId=${lastId.current}`)
            .then((d) => addMessages(d.messages))
            .catch(() => {});
        }
        reconnecting = true;
      };
      ws.onmessage = (e) => {
        const msg = JSON.parse(e.data);
        if (msg.type === 'chat') addMessages([msg.message]);
        if (msg.type === 'comment') addComments([msg.comment]);
      };
      ws.onclose = () => {
        retry = setTimeout(connect, 2000);
      };
    };
    connect();
    return () => {
      clearTimeout(retry);
      if (ws) {
        ws.onclose = null;
        ws.close();
      }
    };
  }, [videoId, session.user?.id]);

  // Everything up to the playhead, split into what this view shows and what it hides.
  const { visible, hiddenCount } = useMemo(() => {
    const items = [];
    let hidden = 0;
    for (const m of byId.values()) {
      if (m.offsetMs > timeMs) continue;
      if (view === 'live' && m.postedLive === false) hidden += 1;
      else items.push({ type: 'chat', key: `m${m.id}`, at: m.offsetMs, order: Number(m.id), m });
    }
    for (const c of commentsById.values()) {
      if (c.offsetMs > timeMs) continue;
      if (view === 'live') hidden += 1;
      else items.push({ type: 'comment', key: `c${c.id}`, at: c.offsetMs, order: Number(c.id), c });
    }
    items.sort((a, b) => a.at - b.at || (a.type === b.type ? a.order - b.order : a.type === 'chat' ? -1 : 1));
    return { visible: items.slice(-VISIBLE), hiddenCount: hidden };
  }, [byId, commentsById, timeMs, view]);

  useEffect(() => {
    const el = listRef.current;
    if (el && pinned.current) el.scrollTop = el.scrollHeight;
  }, [visible]);

  const onScroll = () => {
    const el = listRef.current;
    pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    setShowJump(!pinned.current);
  };

  const jumpToLatest = () => {
    const el = listRef.current;
    pinned.current = true;
    setShowJump(false);
    if (el) el.scrollTop = el.scrollHeight;
  };

  // Tapping a name (or Reply) starts a reply: @name in the box and a quote of the message.
  const startReply = (m) => {
    if (!session.user) return session.requireSignIn();
    setReplyTarget({ id: m.id, author: m.author, body: m.body });
    const mention = `@${handle(m.author)} `;
    setText((t) => (t.startsWith(mention) ? t : mention + t));
    setError('');
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  // Tapping a quote shows the original: scroll to it if it's in the feed, otherwise seek there.
  const showOriginal = (quote) => {
    const el = listRef.current?.querySelector(`[data-msg="${quote.id}"]`);
    if (el) {
      pinned.current = false;
      el.scrollIntoView({ block: 'center', behavior: 'smooth' });
      setFlashId(quote.id);
      setTimeout(() => setFlashId(null), 1600);
    } else if (quote.offsetMs !== null && quote.offsetMs !== undefined) {
      onSeek?.(quote.offsetMs);
    }
  };

  // @ suggestions: names seen in this video's chat and comments, matching what's typed after "@".
  const names = useMemo(() => {
    const seen = new Map();
    for (const m of byId.values()) seen.set(handle(m.author).toLowerCase(), handle(m.author));
    for (const c of commentsById.values()) seen.set(handle(c.author).toLowerCase(), handle(c.author));
    return [...seen.values()];
  }, [byId, commentsById]);

  const updateSuggestions = (value, caret) => {
    const match = value.slice(0, caret).match(/(?:^|\s)@([A-Za-z0-9_.-]{0,30})$/);
    if (!match) return setSuggest({ items: [], index: 0 });
    const typed = match[1].toLowerCase();
    const items = names
      .filter((n) => n.toLowerCase().startsWith(typed) && n.toLowerCase() !== typed)
      .slice(0, 5);
    setSuggest({ items, index: 0 });
  };

  const pickSuggestion = (name) => {
    const el = inputRef.current;
    const caret = el?.selectionStart ?? text.length;
    const before = text.slice(0, caret).replace(/@([A-Za-z0-9_.-]{0,30})$/, `@${name} `);
    const next = before + text.slice(caret);
    setText(next);
    setSuggest({ items: [], index: 0 });
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(before.length, before.length);
    });
  };

  const onKeyDown = (e) => {
    if (!suggest.items.length) {
      if (e.key === 'Escape' && replyTarget) setReplyTarget(null);
      return;
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const step = e.key === 'ArrowDown' ? 1 : -1;
      setSuggest((s) => ({ ...s, index: (s.index + step + s.items.length) % s.items.length }));
    } else if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault();
      pickSuggestion(suggest.items[suggest.index]);
    } else if (e.key === 'Escape') {
      setSuggest({ items: [], index: 0 });
    }
  };

  const send = async (e) => {
    e.preventDefault();
    if (!session.user) return session.requireSignIn();
    if (!text.trim()) return setError('Type a message first.');
    setSending(true);
    try {
      const { message } = await api(`/videos/${videoId}/chat`, {
        method: 'POST',
        body: { text, offsetMs: getTimeMs(), ...(replyTarget && { replyToId: replyTarget.id }) },
      });
      addMessages([message]);
      setText('');
      setReplyTarget(null);
      // Your own post is replay chat; switch views so it doesn't vanish from your feed.
      if (view === 'live' && message.postedLive === false) changeView('all');
      jumpToLatest();
    } catch (err) {
      setError(err.message);
    } finally {
      setSending(false);
    }
  };

  const me = session.user?.username;

  return (
    <aside className="chat">
      <header className="chat-head">
        <div className="chat-title">
          <h2>Live chat replay</h2>
          <span className="muted small">Synced to {formatTime(timeMs / 1000)}</span>
        </div>
        <div className="chat-view" role="group" aria-label="Which chat to show">
          <button type="button" aria-pressed={view === 'live'} onClick={() => changeView('live')}>
            Live only
          </button>
          <button type="button" aria-pressed={view === 'all'} onClick={() => changeView('all')}>
            Live + replay
          </button>
        </div>
      </header>

      <div className="chat-body">
        <ol className="chat-list" ref={listRef} onScroll={onScroll} aria-live="polite">
          {visible.length === 0 && (
            <li className="chat-empty muted">Chat appears here as the video plays.</li>
          )}
          {visible.map((item) =>
            item.type === 'chat' ? (
              <ChatMessage
                key={item.key}
                m={item.m}
                me={me}
                flash={flashId === item.m.id}
                onSeek={onSeek}
                onReply={startReply}
                onQuote={showOriginal}
              />
            ) : (
              <CommentBubble key={item.key} c={item.c} onSeek={onSeek} onOpenThread={onOpenThread} />
            ),
          )}
        </ol>
        {view === 'live' && hiddenCount > 0 && (
          <button type="button" className="later-viewers" onClick={() => changeView('all')}>
            +{hiddenCount} from later viewers
          </button>
        )}
        {showJump && (
          <button type="button" className="jump-latest" onClick={jumpToLatest}>
            Jump to latest
          </button>
        )}
      </div>

      <form className="chat-compose" onSubmit={send}>
        {replyTarget && (
          <div className="reply-chip">
            <span className="reply-chip-text">
              Replying to <b>{replyTarget.author}</b>: {replyTarget.body}
            </span>
            <button type="button" aria-label="Cancel reply" onClick={() => setReplyTarget(null)}>
              ×
            </button>
          </div>
        )}
        {suggest.items.length > 0 && (
          <ul className="mention-suggest" role="listbox" aria-label="People in this chat">
            {suggest.items.map((n, i) => (
              <li key={n} role="option" aria-selected={i === suggest.index}>
                <button
                  type="button"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    pickSuggestion(n);
                  }}
                >
                  @{n}
                </button>
              </li>
            ))}
          </ul>
        )}
        <input
          id="chat-input"
          ref={inputRef}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setError('');
            updateSuggestions(e.target.value, e.target.selectionStart);
          }}
          onKeyDown={onKeyDown}
          onBlur={() => setSuggest({ items: [], index: 0 })}
          placeholder={session.user ? `Chat as ${session.user.username}` : 'Sign in to chat'}
          aria-label="Chat message"
          maxLength={200}
          autoComplete="off"
          onFocus={() => !session.user && session.requireSignIn()}
        />
        <button className="primary-btn" disabled={sending}>
          Send
        </button>
        {error && <p className="error small">{error}</p>}
      </form>
    </aside>
  );
}

function Stamp({ at, onSeek }) {
  return (
    <button
      type="button"
      className="chat-ts"
      onClick={() => onSeek?.(at)}
      title="Play from this moment"
      aria-label={`Play from ${formatTime(at / 1000)}`}
    >
      {formatTime(at / 1000)}
    </button>
  );
}

function Quote({ q, onQuote }) {
  return (
    <button type="button" className="quote" onClick={() => onQuote?.(q)} title="Show the original message">
      <span aria-hidden="true">↪</span> <b>{q.author}</b> {q.body}
    </button>
  );
}

function ChatMessage({ m, me, flash, onSeek, onReply, onQuote }) {
  const mentionsMe = me && m.mentions?.includes(me.toLowerCase());
  const replay = m.postedLive === false;
  const body = m.body.split(MENTION_SPLIT).map((p, i) =>
    p.startsWith('@') ? (
      <span key={i} className="mention">
        {p}
      </span>
    ) : (
      p
    ),
  );
  const author = (
    <button type="button" className="author" onClick={() => onReply(m)} title={`Reply to ${m.author}`}>
      {m.author}
    </button>
  );

  if (m.kind === 'paid') {
    return (
      <li className={`chat-msg paid ${flash ? 'flash' : ''}`} data-msg={m.id}>
        <div className="paid-head">
          <Avatar m={m} />
          {author}
          <strong className="amount">{m.amount}</strong>
        </div>
        <Stamp at={m.offsetMs} onSeek={onSeek} />
        {m.body && <p>{body}</p>}
      </li>
    );
  }

  return (
    <li
      data-msg={m.id}
      className={[
        'chat-msg',
        m.kind === 'membership' && 'membership',
        mentionsMe && 'mentions-me',
        replay && 'replay',
        flash && 'flash',
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <Avatar m={m} />
      <div className="chat-main">
        {m.replyTo && <Quote q={m.replyTo} onQuote={onQuote} />}
        <p>
          <span className={`source-tag ${m.source}`}>{m.source === 'youtube' ? 'YT' : 'JB'}</span>
          {replay && <span className="replay-tag">replay</span>}
          {author}
          {body}
        </p>
      </div>
      <Stamp at={m.offsetMs} onSeek={onSeek} />
    </li>
  );
}

// A timestamped comment, shown in the chat at its moment.
function CommentBubble({ c, onSeek, onOpenThread }) {
  const threadId = c.parentId ?? c.id;
  return (
    <li className="chat-comment" data-comment={c.id}>
      <div className="chat-comment-head">
        <span className="comment-label">Comment</span>
        <b>{c.author}</b>
        <span className={`source-tag ${c.source}`}>{c.source === 'youtube' ? 'YT' : 'JB'}</span>
      </div>
      {c.replyTo && (
        <p className="quote static">
          <span aria-hidden="true">↪</span> <b>{c.replyTo.author}</b> {c.replyTo.body}
        </p>
      )}
      <p className="chat-comment-body">{c.body}</p>
      <div className="chat-comment-foot">
        <button type="button" className="text-btn" onClick={() => onOpenThread?.(threadId)}>
          {c.replyCount > 0
            ? `View thread · ${c.replyCount} ${c.replyCount === 1 ? 'reply' : 'replies'}`
            : 'View thread'}
        </button>
      </div>
      <Stamp at={c.offsetMs} onSeek={onSeek} />
    </li>
  );
}

function Avatar({ m }) {
  return m.authorPhoto ? (
    <img className="chat-avatar" src={m.authorPhoto} alt="" loading="lazy" referrerPolicy="no-referrer" />
  ) : (
    <span className="chat-avatar initial">{handle(m.author)[0]?.toUpperCase()}</span>
  );
}
