import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import MemberBadge from './MemberBadge.jsx';

// A member's name in chat or comments (MBJ-116). Tapping it opens a small card: who they are, View profile, and
// whatever actions the place offers (Reply, Mention). Names without a site account stay plain (or just reply).
export default function NameCard({
  name,
  profile,
  tier,
  platformName,
  className = 'author',
  title,
  actions = [],
  onPlainClick,
}) {
  const [open, setOpen] = useState(false);
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

  return (
    <span className="name-card-wrap" ref={ref}>
      <button
        type="button"
        className={className}
        aria-haspopup="dialog"
        aria-expanded={open}
        title={title}
        onClick={() => setOpen((o) => !o)}
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
            {actions.map((a) => (
              <button
                key={a.label}
                type="button"
                className="text-btn"
                onClick={() => {
                  setOpen(false);
                  a.onClick();
                }}
              >
                {a.label}
              </button>
            ))}
          </span>
        </span>
      )}
    </span>
  );
}
