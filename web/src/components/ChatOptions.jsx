import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';

// The ⋯ in the chat header: people you muted or blocked (with Unmute / Unblock), who you highlighted in this chat,
// and your favorites (MBJ-119, 219, 220).
export default function ChatOptions({ session, highlights, onClearHighlight }) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState('');
  const ref = useRef(null);
  const hidden = session.user?.hidden || [];
  const favorites = session.user?.favorites || [];
  const highlighted = Object.entries(highlights);

  useEffect(() => {
    if (!open) return undefined;
    // On a phone the chat can sit low on the page: bring the menu on screen.
    ref.current?.querySelector('.chat-options-menu')?.scrollIntoView?.({ block: 'nearest' });
    const close = (e) => !ref.current?.contains(e.target) && setOpen(false);
    const onKey = (e) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', close);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const undo = async (username) => {
    setError('');
    try {
      await api(`/account/blocks/${encodeURIComponent(username)}`, { method: 'DELETE' });
      session.refreshUser?.();
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <span className="chat-options" ref={ref}>
      <button
        type="button"
        className="chat-help-btn"
        aria-label="Chat options"
        title="Chat options"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        ⋯
      </button>
      {open && (
        <div className="chat-options-menu" role="dialog" aria-label="Chat options">
          <h3>Muted and blocked</h3>
          {!session.user ? (
            <p className="muted small">Sign in to mute or block people.</p>
          ) : hidden.length === 0 ? (
            <p className="muted small">Nobody. Tap someone’s picture to mute or block them.</p>
          ) : (
            <ul>
              {hidden.map((h) => (
                <li key={h.username}>
                  <span>
                    {h.username} <span className="badge">{h.kind === 'block' ? 'Blocked' : 'Muted'}</span>
                  </span>
                  <button type="button" className="text-btn" onClick={() => undo(h.username)}>
                    {h.kind === 'block' ? 'Unblock' : 'Unmute'}
                  </button>
                </li>
              ))}
            </ul>
          )}

          <h3>Highlighted in this chat</h3>
          {highlighted.length === 0 ? (
            <p className="muted small">Nobody. Tap someone’s picture to pick a color.</p>
          ) : (
            <ul>
              {highlighted.map(([color, p]) => (
                <li key={color}>
                  <span>
                    <span className={`swatch small hl-${color}`} aria-hidden="true" /> {p.name}
                  </span>
                  <button type="button" className="text-btn" onClick={() => onClearHighlight(color)}>
                    Clear
                  </button>
                </li>
              ))}
            </ul>
          )}

          <h3>
            Favorites <span className="tier-pill tier-premium">Premium</span>
          </h3>
          <p className="muted small">
            {favorites.length
              ? `${favorites.length} highlighted in every chat. `
              : 'Highlighted in your color in every chat. '}
            {session.user && (
              <Link to="/account" onClick={() => setOpen(false)}>
                Manage in Account settings
              </Link>
            )}
          </p>
          {error && <p className="error small">{error}</p>}
        </div>
      )}
    </span>
  );
}
