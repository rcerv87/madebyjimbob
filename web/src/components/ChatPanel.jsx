import { useEffect, useMemo, useRef, useState } from 'react';
import { api, formatTime, getToken } from '../api.js';

const WINDOW_MS = 120_000;
const VISIBLE = 150;
// Same rule as MENTION_RE in server/src/moderation.js, with the whole @name captured for split().
const MENTION_SPLIT = /((?<![A-Za-z0-9_])@[A-Za-z0-9_][A-Za-z0-9_.-]{1,30}[A-Za-z0-9_])/g;

export default function ChatPanel({ videoId, timeMs, getTimeMs, onSeek, session }) {
  const [byId, setById] = useState(() => new Map());
  const loaded = useRef(new Set());
  const listRef = useRef(null);
  const pinned = useRef(true);
  const lastId = useRef(0);
  const [showJump, setShowJump] = useState(false);
  const [text, setText] = useState('');
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

  // Reset when switching videos
  useEffect(() => {
    setById(new Map());
    loaded.current = new Set();
    lastId.current = 0;
  }, [videoId]);

  // Load the current and next 2-minute windows as playback moves
  const windowIdx = Math.floor(timeMs / WINDOW_MS);
  useEffect(() => {
    for (const idx of [windowIdx, windowIdx + 1]) {
      if (loaded.current.has(idx)) continue;
      loaded.current.add(idx);
      api(`/videos/${videoId}/chat?from=${idx * WINDOW_MS}&to=${(idx + 1) * WINDOW_MS}`)
        .then((d) => addMessages(d.messages))
        .catch(() => loaded.current.delete(idx));
    }
  }, [videoId, windowIdx]);

  // Realtime: messages other viewers post while watching
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

  const visible = useMemo(() => {
    const shown = [];
    for (const m of byId.values()) if (m.offsetMs <= timeMs) shown.push(m);
    shown.sort((a, b) => a.offsetMs - b.offsetMs || a.id - b.id);
    return shown.slice(-VISIBLE);
  }, [byId, timeMs]);

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

  const send = async (e) => {
    e.preventDefault();
    if (!session.user) return session.requireSignIn();
    if (!text.trim()) return setError('Type a message first.');
    setSending(true);
    try {
      const { message } = await api(`/videos/${videoId}/chat`, {
        method: 'POST',
        body: { text, offsetMs: getTimeMs() },
      });
      addMessages([message]);
      setText('');
      jumpToLatest();
    } catch (err) {
      setError(err.message);
    } finally {
      setSending(false);
    }
  };

  return (
    <aside className="chat">
      <header className="chat-head">
        <h2>Live chat replay</h2>
        <span className="muted small">Synced to {formatTime(timeMs / 1000)}</span>
      </header>

      <div className="chat-body">
        <ol className="chat-list" ref={listRef} onScroll={onScroll} aria-live="polite">
          {visible.length === 0 && (
            <li className="chat-empty muted">Chat appears here as the video plays.</li>
          )}
          {visible.map((m) => (
            <ChatMessage key={m.id} m={m} me={session.user?.username} onSeek={onSeek} />
          ))}
        </ol>
        {showJump && (
          <button type="button" className="jump-latest" onClick={jumpToLatest}>
            Jump to latest
          </button>
        )}
      </div>

      <form className="chat-compose" onSubmit={send}>
        <input
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setError('');
          }}
          placeholder={session.user ? `Chat as ${session.user.username}` : 'Sign in to chat'}
          maxLength={200}
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

function ChatMessage({ m, me, onSeek }) {
  const mentionsMe = me && m.mentions?.includes(me.toLowerCase());
  const parts = m.body.split(MENTION_SPLIT);

  const body = parts.map((p, i) =>
    p.startsWith('@') ? (
      <span key={i} className="mention">
        {p}
      </span>
    ) : (
      p
    ),
  );

  const stamp = (
    <button
      type="button"
      className="chat-ts"
      onClick={() => onSeek?.(m.offsetMs)}
      title="Play from this moment"
      aria-label={`Play from ${formatTime(m.offsetMs / 1000)}`}
    >
      {formatTime(m.offsetMs / 1000)}
    </button>
  );

  if (m.kind === 'paid') {
    return (
      <li className="chat-msg paid">
        <div className="paid-head">
          <Avatar m={m} />
          <span className="author">{m.author}</span>
          <strong className="amount">{m.amount}</strong>
        </div>
        {stamp}
        {m.body && <p>{body}</p>}
      </li>
    );
  }

  return (
    <li
      className={`chat-msg ${m.kind === 'membership' ? 'membership' : ''} ${mentionsMe ? 'mentions-me' : ''}`}
    >
      <Avatar m={m} />
      <p>
        <span className={`source-tag ${m.source}`}>{m.source === 'youtube' ? 'YT' : 'JB'}</span>
        <span className="author">{m.author}</span>
        {body}
      </p>
      {stamp}
    </li>
  );
}

function Avatar({ m }) {
  return m.authorPhoto ? (
    <img className="chat-avatar" src={m.authorPhoto} alt="" loading="lazy" referrerPolicy="no-referrer" />
  ) : (
    <span className="chat-avatar initial">{m.author[0]?.toUpperCase()}</span>
  );
}
