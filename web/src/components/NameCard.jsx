import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import MemberBadge from './MemberBadge.jsx';

// A member's name in chat or comments (MBJ-116). Tapping it opens a small card: who they are, View profile, and
// whatever actions the place offers (Reply, Mention), plus Mute, Block, and Report for signed-in viewers
// (MBJ-119; `moderation` = { me, onChanged }). Names without a site account stay plain (or just reply).
export default function NameCard({
  name,
  profile,
  tier,
  platformName,
  className = 'author',
  title,
  actions = [],
  onPlainClick,
  moderation,
  about = {}, // { chatMessageId } or { commentId }: what a report is about
}) {
  const [open, setOpen] = useState(false);
  const [reporting, setReporting] = useState(false);
  const [note, setNote] = useState('');
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const close = (e) => !ref.current?.contains(e.target) && setOpen(false);
    const onKey = (e) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', close);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  if (!profile) {
    return onPlainClick ? (
      <button type="button" className={className} onClick={onPlainClick} title={title}>
        {name}
      </button>
    ) : (
      <span className={className} title={title}>
        {name}
      </span>
    );
  }

  const canModerate = moderation?.me && moderation.me.toLowerCase() !== profile.toLowerCase();
  const hide = async (kind) => {
    try {
      await api(`/account/blocks/${encodeURIComponent(profile)}`, { method: 'PUT', body: { kind } });
      setNote(kind === 'block' ? `Blocked ${profile}. Undo in Account settings.` : `Muted ${profile}.`);
      moderation.onChanged?.();
    } catch (err) {
      setNote(err.message);
    }
  };
  const all = [
    ...actions,
    ...(canModerate
      ? [
          { label: 'Mute', onClick: () => hide('mute'), keepOpen: true },
          { label: 'Block', onClick: () => hide('block'), keepOpen: true },
          { label: 'Report…', onClick: () => setReporting(true) },
        ]
      : []),
  ];

  return (
    <span className="name-card-wrap" ref={ref}>
      <button
        type="button"
        className={className}
        aria-haspopup="dialog"
        aria-expanded={open}
        title={title}
        onClick={() => {
          setNote('');
          setOpen((o) => !o);
        }}
      >
        {name}
      </button>
      {open && (
        <span className="name-card" role="dialog" aria-label={`${profile}’s card`}>
          <span className="name-card-who">
            <span className="avatar" aria-hidden="true">
              {profile[0].toUpperCase()}
            </span>
            <span>
              <strong>{profile}</strong>
              <MemberBadge tier={tier} />
              {platformName && <span className="muted small">{platformName} on YouTube</span>}
            </span>
          </span>
          <span className="name-card-actions">
            <Link to={`/@${profile}`} onClick={() => setOpen(false)}>
              View profile
            </Link>
            {all.map((a) => (
              <button
                key={a.label}
                type="button"
                className="text-btn"
                onClick={() => {
                  if (!a.keepOpen) setOpen(false);
                  a.onClick();
                }}
              >
                {a.label}
              </button>
            ))}
          </span>
          {note && <span className="small">{note}</span>}
        </span>
      )}
      {reporting &&
        createPortal(
          <ReportDialog username={profile} about={about} onClose={() => setReporting(false)} />,
          document.body,
        )}
    </span>
  );
}

const REASONS = [
  ['spam', 'Spam or scams'],
  ['harassment', 'Harassment or bullying'],
  ['hate', 'Hate'],
  ['sexual', 'Sexual content'],
  ['violence', 'Violence or threats'],
  ['impersonation', 'Pretending to be someone else'],
  ['other', 'Something else'],
];

// Report a member (and the message or comment, when there is one) to the moderators.
export function ReportDialog({ username, about = {}, onClose }) {
  const [reason, setReason] = useState('');
  const [details, setDetails] = useState('');
  const [error, setError] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    if (!reason) return setError('Pick a reason.');
    setBusy(true);
    try {
      await api('/reports', {
        method: 'POST',
        body: { username, ...about, reason, details: details.trim() || undefined },
      });
      setSent(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="dialog-backdrop" onClick={onClose}>
      <form className="dialog" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <h2>Report {username}</h2>
        {sent ? (
          <p>
            Thanks. The moderators will look at it. You can also mute or block {username} from their name.
          </p>
        ) : (
          <>
            <p className="muted small">
              {about.chatMessageId || about.commentId
                ? 'About this message. Only the moderators see reports.'
                : 'Only the moderators see reports.'}
            </p>
            <label>
              What’s wrong?
              <select value={reason} onChange={(e) => setReason(e.target.value)} required>
                <option value="">Choose a reason</option>
                {REASONS.map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Anything else (optional)
              <input value={details} onChange={(e) => setDetails(e.target.value)} maxLength={1000} />
            </label>
            {error && (
              <p className="error" role="alert">
                {error}
              </p>
            )}
          </>
        )}
        <div className="dialog-actions">
          <button type="button" className="text-btn" onClick={onClose}>
            {sent ? 'Close' : 'Cancel'}
          </button>
          {!sent && (
            <button className="primary-btn" disabled={busy}>
              Send report
            </button>
          )}
        </div>
      </form>
    </div>
  );
}
