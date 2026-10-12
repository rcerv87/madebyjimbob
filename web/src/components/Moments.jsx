import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { api, formatTime, timeoutNote } from '../api.js';
import { useClock } from '../clock.js';
import { favoriteMap } from '../favorites.js';
import NameCard from './NameCard.jsx';
import MemberBadge from './MemberBadge.jsx';

// The five reactions, in the order they're offered. The color is the strip's when that reaction leads a minute.
export const REACTION = {
  funny: { label: 'Funny', emoji: '😂', color: '#f2b33a' },
  interesting: { label: 'Interesting', emoji: '💡', color: '#4aa3ff' },
  fire: { label: 'Fire', emoji: '🔥', color: '#ff6a3d' },
  boring: { label: 'Boring', emoji: '😴', color: '#8a94a3' },
  cringe: { label: 'Cringe', emoji: '😬', color: '#c06bd6' },
};
const CHAT_COLOR = '#3fb3bf';
const MAX_STRETCH_MS = 30 * 60 * 1000;
const DRAG_PX = 6;

// One entry per minute: how busy chat was, the reactions (weighted), and which reaction leads.
// `level` is 0–1 for how strongly to draw it; a minute with reactions always outshines a chat-only one.
export function minuteBars(data) {
  if (!data) return [];
  const byMinute = new Map();
  for (const r of data.reactions) {
    const at = byMinute.get(r.minute) || {};
    at[r.kind] = r;
    byMinute.set(r.minute, at);
  }
  const total = (kinds) => Object.values(kinds).reduce((n, r) => n + r.score, 0);
  const maxChat = Math.max(1, ...data.chat);
  const maxReact = Math.max(1, ...[...byMinute.values()].map(total));
  return data.chat.map((chat, minute) => {
    const kinds = byMinute.get(minute) || {};
    const score = total(kinds);
    const top = Object.values(kinds).sort((a, b) => b.score - a.score)[0]?.kind || null;
    return {
      minute,
      chat,
      kinds,
      top,
      level: top ? 0.45 + 0.55 * (score / maxReact) : chat ? 0.12 + 0.4 * (chat / maxChat) : 0,
    };
  });
}

// "12:00 · 14 chat messages · Funny 3, Fire 1"
export function describeMinute(bar) {
  const parts = [formatTime(bar.minute * 60)];
  if (bar.chat) parts.push(`${bar.chat} chat message${bar.chat === 1 ? '' : 's'}`);
  const reacts = Object.values(bar.kinds)
    .sort((a, b) => b.score - a.score)
    .map((r) => `${REACTION[r.kind].label} ${r.people}`);
  if (reacts.length) parts.push(reacts.join(', '));
  return parts.join(' · ');
}

// The current minute of the video; re-renders only when it changes (the clock itself ticks 4 times a second).
const useMinute = (clock) => useSyncExternalStore(clock.subscribe, () => Math.floor(clock.get() / 60000));

function Playhead({ clock, durationMs }) {
  const ms = useClock(clock);
  return <span className="moments-playhead" style={{ left: `${Math.min(100, (ms / durationMs) * 100)}%` }} />;
}

// Under the player (MBJ-217, MBJ-613): a strip of the whole video, minute by minute, colored by the reaction that
// leads each minute and by how busy chat was, with members' notes pinned on it. Tap it to jump; drag across it to
// pick a stretch. Below: one-tap reactions for the moment (or the stretch), and the notes.
export default function Moments({ video, clock, onSeek, session }) {
  const [data, setData] = useState(null);
  const [selection, setSelection] = useState(null); // { fromMs, toMs }: a stretch picked by dragging
  const [hover, setHover] = useState(null); // { pct, bar }
  const [noteAt, setNoteAt] = useState(null); // { fromMs, toMs | null } while the note form is open
  const [text, setText] = useState('');
  const [isPrivate, setIsPrivate] = useState(false);
  const [favOnly, setFavOnly] = useState(false);
  const [flash, setFlash] = useState(null);
  const [error, setError] = useState('');
  const stripRef = useRef(null);
  const drag = useRef(null);
  const minute = useMinute(clock);

  const load = useCallback(
    () =>
      api(`/videos/${video.id}/moments`)
        .then(setData)
        .catch(() => {}),
    [video.id],
  );
  useEffect(() => {
    load();
  }, [load]);

  const bars = useMemo(() => minuteBars(data), [data]);
  const durationMs = video.durationS ? video.durationS * 1000 : (data?.minutes || 0) * 60000;
  const user = session.user;
  const favorites = useMemo(() => favoriteMap(user), [user]);
  const hiddenNames = useMemo(
    () => new Set((user?.hidden || []).map((h) => h.username.toLowerCase())),
    [user],
  );
  const notes = useMemo(() => {
    const shown = (data?.notes || []).filter((n) => !hiddenNames.has(n.author.toLowerCase()));
    const fav = (n) => favorites.has(n.author.toLowerCase());
    // Favorites first, each group in video order.
    return shown
      .filter((n) => !favOnly || fav(n))
      .sort((a, b) => Number(fav(b)) - Number(fav(a)) || a.offsetMs - b.offsetMs);
  }, [data, hiddenNames, favorites, favOnly]);

  if (!data || !durationMs) return null;

  const msAt = (clientX) => {
    const box = stripRef.current.getBoundingClientRect();
    return Math.round(Math.min(1, Math.max(0, (clientX - box.left) / box.width)) * durationMs);
  };
  const onPointerDown = (e) => {
    if (e.button > 0) return;
    drag.current = { x: e.clientX, startMs: msAt(e.clientX), moved: false };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };
  const onPointerMove = (e) => {
    const box = stripRef.current.getBoundingClientRect();
    const pct = Math.min(1, Math.max(0, (e.clientX - box.left) / box.width));
    setHover({ pct, bar: bars[Math.min(bars.length - 1, Math.floor((pct * durationMs) / 60000))] });
    const d = drag.current;
    if (!d) return;
    if (Math.abs(e.clientX - d.x) > DRAG_PX) d.moved = true;
    if (d.moved) {
      const now = msAt(e.clientX);
      const fromMs = Math.min(d.startMs, now);
      setSelection({ fromMs, toMs: Math.min(Math.max(d.startMs, now), fromMs + MAX_STRETCH_MS) });
    }
  };
  const onPointerUp = (e) => {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    if (!d.moved) {
      setSelection(null);
      onSeek(msAt(e.clientX));
    }
  };

  const signedIn = () => {
    if (user) return true;
    session.requireSignIn();
    return false;
  };
  const react = async (kind) => {
    if (!signedIn()) return;
    setError('');
    const body = selection
      ? { kind, offsetMs: selection.fromMs, endMs: selection.toMs }
      : { kind, offsetMs: clock.get() };
    try {
      await api(`/videos/${video.id}/reactions`, { method: 'POST', body });
      setSelection(null);
      load();
    } catch (err) {
      setError(err.message);
    }
  };
  // Lit when you've already reacted that way in this minute (tapping again takes it back).
  const reacted = (kind) =>
    data.mine.some((r) => r.kind === kind && Math.floor(r.offsetMs / 60000) === minute);

  const openNote = () => {
    if (!signedIn()) return;
    setError('');
    setNoteAt(selection ? { ...selection } : { fromMs: clock.get(), toMs: null });
  };
  const saveNote = async (e) => {
    e.preventDefault();
    setError('');
    try {
      await api(`/videos/${video.id}/notes`, {
        method: 'POST',
        body: { text: text.trim(), offsetMs: noteAt.fromMs, endMs: noteAt.toMs, private: isPrivate },
      });
      setText('');
      setIsPrivate(false);
      setNoteAt(null);
      setSelection(null);
      load();
    } catch (err) {
      setError(err.message);
    }
  };
  const removeNote = async (id) => {
    setError('');
    try {
      await api(`/notes/${id}`, { method: 'DELETE' });
      load();
    } catch (err) {
      setError(err.message);
    }
  };
  const jump = (n) => {
    onSeek(n.offsetMs);
    setFlash(n.id);
    setTimeout(() => setFlash(null), 1600);
  };

  const pct = (ms) => `${Math.min(100, (ms / durationMs) * 100)}%`;
  const moderation = user
    ? {
        me: user.username,
        staff: Boolean(user.isAdmin),
        onChanged: session.refreshUser,
        premium: user.tier === 'premium',
        favorites,
      }
    : null;
  const blocked = timeoutNote(user);
  const span = (from, to) =>
    to ? `${formatTime(from / 1000)} to ${formatTime(to / 1000)}` : formatTime(from / 1000);

  return (
    <section className="moments" aria-label="Moments in this video">
      <div
        className="moments-strip"
        ref={stripRef}
        role="group"
        aria-label="The video minute by minute: reactions, chat activity and notes. Tap to jump, drag to pick a stretch."
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={() => setHover(null)}
        onPointerCancel={() => {
          drag.current = null;
        }}
      >
        <div className="moments-bars" aria-hidden="true">
          {bars.map((b) => (
            <span
              key={b.minute}
              style={
                b.level
                  ? { background: b.top ? REACTION[b.top].color : CHAT_COLOR, opacity: b.level }
                  : undefined
              }
            />
          ))}
        </div>
        {selection && (
          <span
            className="moments-selection"
            style={{ left: pct(selection.fromMs), width: pct(selection.toMs - selection.fromMs) }}
          />
        )}
        {notes.map((n) => (
          <span
            key={n.id}
            className={`moments-pin ${n.endMs ? 'stretch' : ''} ${
              favorites.has(n.author.toLowerCase()) ? `hl-${favorites.get(n.author.toLowerCase())}` : ''
            }`}
            style={{ left: pct(n.offsetMs), width: n.endMs ? pct(n.endMs - n.offsetMs) : undefined }}
            aria-hidden="true"
          />
        ))}
        <Playhead clock={clock} durationMs={durationMs} />
        {hover?.bar && !drag.current && (
          <span
            className="moments-tip"
            style={{ left: `${Math.min(85, Math.max(15, hover.pct * 100))}%` }}
            aria-hidden="true"
          >
            {describeMinute(hover.bar)}
          </span>
        )}
      </div>

      <div className="moments-bar">
        <div className="moments-reactions" role="group" aria-label="React to this moment">
          {Object.entries(REACTION).map(([kind, r]) => (
            <button
              key={kind}
              type="button"
              className="chip moments-react"
              aria-pressed={!selection && reacted(kind)}
              onClick={() => react(kind)}
              title={selection ? `Mark this stretch ${r.label.toLowerCase()}` : `${r.label} right here`}
            >
              <span aria-hidden="true">{r.emoji}</span> {r.label}
            </button>
          ))}
        </div>
        <button type="button" className="text-btn" onClick={openNote} disabled={Boolean(blocked)}>
          + Add a note
        </button>
      </div>
      {selection && (
        <p className="small moments-hint">
          Stretch picked: {span(selection.fromMs, selection.toMs)}. Tap a reaction or Add a note for it.{' '}
          <button type="button" className="text-btn small" onClick={() => setSelection(null)}>
            Clear
          </button>
        </p>
      )}
      {blocked && <p className="muted small">{blocked}</p>}
      {error && (
        <p className="error small" role="alert">
          {error}
        </p>
      )}

      {noteAt && (
        <form className="moments-note-form" onSubmit={saveNote}>
          <label>
            Note at {span(noteAt.fromMs, noteAt.toMs)}
            <input
              autoFocus
              value={text}
              onChange={(e) => setText(e.target.value)}
              maxLength={280}
              placeholder="e.g. This is where he really goes off"
              required
            />
          </label>
          <label className="check small">
            <input type="checkbox" checked={isPrivate} onChange={(e) => setIsPrivate(e.target.checked)} />
            Just for me
          </label>
          <button className="primary-btn small" disabled={!text.trim()}>
            Save note
          </button>
          <button type="button" className="text-btn small" onClick={() => setNoteAt(null)}>
            Cancel
          </button>
        </form>
      )}

      {(notes.length > 0 || favOnly) && (
        <details className="moments-notes" open>
          <summary>
            Notes ({notes.length})
            {favorites.size > 0 && (
              <label className="check small" onClick={(e) => e.stopPropagation()}>
                <input type="checkbox" checked={favOnly} onChange={(e) => setFavOnly(e.target.checked)} />
                Favorites only
              </label>
            )}
          </summary>
          {notes.length === 0 && <p className="muted small">None of your favorites have left a note here.</p>}
          <ol>
            {notes.map((n) => {
              const color = favorites.get(n.author.toLowerCase());
              return (
                <li key={n.id} className={`${flash === n.id ? 'flash' : ''} ${color ? `hl-${color}` : ''}`}>
                  <button type="button" className="moments-time" onClick={() => jump(n)}>
                    {span(n.offsetMs, n.endMs)}
                  </button>
                  <span className="moments-note-text">{n.body}</span>
                  <span className="moments-note-by small">
                    <NameCard
                      name={n.author}
                      profile={n.profile}
                      tier={n.memberTier}
                      className="comment-author"
                      moderation={moderation}
                      about={{ noteId: n.id }}
                    />
                    <MemberBadge tier={n.memberTier} />
                    {n.private && <span className="badge">Just for me</span>}
                    {(n.mine || user?.isAdmin) && (
                      <button type="button" className="text-btn small" onClick={() => removeNote(n.id)}>
                        {n.mine ? 'Delete' : 'Take down'}
                      </button>
                    )}
                  </span>
                </li>
              );
            })}
          </ol>
        </details>
      )}
    </section>
  );
}
