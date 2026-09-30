import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { api, formatTime, timeAgo } from './api.js';
import { usePush } from './push.js';

// Link a notification opens: the video at that moment, plus the comment thread for comments.
export function notificationUrl(n) {
  const params = new URLSearchParams();
  if (n.offsetMs !== null && n.offsetMs !== undefined) params.set('t', String(Math.floor(n.offsetMs / 1000)));
  if (n.commentId) params.set('comment', String(n.commentId));
  // Mentions and replies from the site are replay chat, hidden in Live only; show them.
  else params.set('chat', 'all');
  const q = params.toString();
  return `/watch/${n.videoId}${q ? `?${q}` : ''}`;
}

export function describe(n) {
  if (n.type === 'reply') return `${n.actor} replied to you`;
  return `${n.actor} mentioned you in ${n.where === 'comment' ? 'a comment' : 'chat'}`;
}

// Loads the signed-in user's notifications and listens for new ones on a WebSocket.
export function useNotifications(user) {
  const [items, setItems] = useState([]);
  const [unread, setUnread] = useState(0);
  const [toast, setToast] = useState(null);

  const refresh = useCallback(() => {
    if (!user) return;
    api('/notifications')
      .then((d) => {
        setItems(d.notifications);
        setUnread(d.unread);
      })
      .catch(() => {});
  }, [user]);

  useEffect(() => {
    setItems([]);
    setUnread(0);
    setToast(null);
    if (!user) return;
    refresh();
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    let ws;
    let retry;
    const connect = () => {
      ws = new WebSocket(`${proto}://${location.host}/ws`);
      ws.onopen = () => ws.send(JSON.stringify({ type: 'auth' }));
      ws.onmessage = (e) => {
        const msg = JSON.parse(e.data);
        if (msg.type !== 'notify') return;
        setItems((list) =>
          [msg.notification, ...list.filter((x) => x.id !== msg.notification.id)].slice(0, 30),
        );
        setUnread((u) => u + 1);
        setToast(msg.notification);
      };
      ws.onclose = () => {
        retry = setTimeout(() => {
          refresh(); // pick up anything missed while disconnected
          connect();
        }, 3000);
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
  }, [user, refresh]);

  const markRead = useCallback((ids) => {
    const all = !ids;
    setItems((list) => list.map((n) => (all || ids.includes(n.id) ? { ...n, read: true } : n)));
    setUnread((u) => (all ? 0 : Math.max(0, u - ids.length)));
    api('/notifications/read', { method: 'POST', body: all ? {} : { ids } }).catch(() => {});
  }, []);

  return { items, unread, toast, dismissToast: () => setToast(null), markRead };
}

export function Bell({ notes }) {
  const [open, setOpen] = useState(false);
  const panelRef = useRef(null);
  const navigate = useNavigate();
  const push = usePush();

  useEffect(() => {
    if (!open) return;
    const close = (e) => !panelRef.current?.contains(e.target) && setOpen(false);
    const onKey = (e) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', close);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const openNote = (n) => {
    if (!n.read) notes.markRead([n.id]);
    setOpen(false);
    navigate(notificationUrl(n));
  };

  return (
    <div className="bell-wrap" ref={panelRef}>
      <button
        type="button"
        className="icon-btn bell"
        aria-label={notes.unread ? `Notifications, ${notes.unread} unread` : 'Notifications'}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
          <path
            d="M6 16V11a6 6 0 1 1 12 0v5l1.5 2h-15zM10 20a2 2 0 0 0 4 0"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinejoin="round"
          />
        </svg>
        {notes.unread > 0 && <span className="bell-count">{notes.unread > 9 ? '9+' : notes.unread}</span>}
      </button>
      {open && (
        <div className="bell-panel" role="dialog" aria-label="Notifications">
          <div className="bell-head">
            <h2>Notifications</h2>
            {notes.unread > 0 && (
              <button type="button" className="text-btn" onClick={() => notes.markRead()}>
                Mark all read
              </button>
            )}
          </div>
          <PushPrompt push={push} />
          {notes.items.length === 0 ? (
            <p className="muted bell-empty">
              When someone @mentions you or replies to you, it shows up here.
            </p>
          ) : (
            <ol className="bell-list">
              {notes.items.map((n) => (
                <li key={n.id}>
                  <button type="button" className={n.read ? '' : 'unread'} onClick={() => openNote(n)}>
                    <span className="bell-line">{describe(n)}</span>
                    <span className="bell-excerpt">{n.excerpt}</span>
                    <span className="bell-meta">
                      {n.videoTitle}
                      {n.offsetMs !== null &&
                        n.offsetMs !== undefined &&
                        ` · ${formatTime(n.offsetMs / 1000)}`}
                      {' · '}
                      {timeAgo(n.createdAt)}
                    </span>
                  </button>
                </li>
              ))}
            </ol>
          )}
        </div>
      )}
    </div>
  );
}

function PushPrompt({ push }) {
  if (push.state === 'on') return <p className="push-note">Phone notifications are on for this device.</p>;
  if (push.state === 'unsupported' || push.state === 'unavailable') return null;
  if (push.state === 'needs-install') {
    return (
      <p className="push-note">
        On iPhone, add this site to your Home Screen first (Share → Add to Home Screen), then turn on
        notifications from the app.
      </p>
    );
  }
  if (push.state === 'denied') {
    return (
      <p className="push-note">
        Notifications are blocked for this site. Allow them in your browser settings.
      </p>
    );
  }
  return (
    <div className="push-prompt">
      <span>Get a notification on this device when someone mentions or replies to you.</span>
      <button type="button" className="primary-btn" onClick={push.enable} disabled={push.busy}>
        {push.busy ? 'Turning on…' : 'Turn on'}
      </button>
      {push.error && <p className="error small">{push.error}</p>}
    </div>
  );
}

// The bubble that pops up when a notification arrives while the site is open.
export function NotificationToast({ notes }) {
  const location = useLocation();
  const navigate = useNavigate();
  const n = notes.toast;

  useEffect(() => {
    if (!n) return;
    const timer = setTimeout(notes.dismissToast, 8000);
    return () => clearTimeout(timer);
  }, [n, notes.dismissToast]);

  if (!n) return null;
  const here = location.pathname === `/watch/${n.videoId}`;
  const go = () => {
    notes.markRead([n.id]);
    notes.dismissToast();
    navigate(notificationUrl(n));
  };

  return (
    <div className="note-toast" role="status">
      <div className="note-toast-text">
        <b>{describe(n)}</b>
        <span>{n.excerpt}</span>
        {!here && <span className="bell-meta">{n.videoTitle}</span>}
      </div>
      <div className="note-toast-actions">
        <button type="button" className="primary-btn" onClick={go}>
          {here ? 'Jump to it' : 'Open'}
        </button>
        <button type="button" className="text-btn" aria-label="Dismiss" onClick={notes.dismissToast}>
          ×
        </button>
      </div>
    </div>
  );
}
