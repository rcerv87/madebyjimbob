import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { TIER_LABEL } from '../api.js';
import { BRAND } from '../brand.js';
import { Bell } from '../notifications.jsx';
import { InstallButton } from '../install.jsx';

export default function TopBar({ user, notes, onSignIn, onSignOut, onMenu }) {
  const [params] = useSearchParams();
  const urlQ = params.get('q') || '';
  const [q, setQ] = useState(urlQ);
  const navigate = useNavigate();
  // Follow the URL (Clear search, the logo, Back) so the box never shows a search that's gone.
  useEffect(() => setQ(urlQ), [urlQ]);

  const submit = (e) => {
    e.preventDefault();
    navigate(q.trim() ? `/?q=${encodeURIComponent(q.trim())}` : '/');
  };

  return (
    <header className="topbar">
      <button className="icon-btn menu-btn" onClick={onMenu} aria-label="Menu">
        <svg viewBox="0 0 24 24" width="22" height="22">
          <path d="M3 6h18M3 12h18M3 18h18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
      </button>
      <Link to="/" className="brand">
        <img className="brand-avatar" src={BRAND.avatar} alt="" width="36" height="36" />
        <span className="brand-name">{BRAND.name}</span>
      </Link>
      <form className="search" onSubmit={submit} role="search">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search streams"
          aria-label="Search streams"
        />
        <button type="submit" aria-label="Search">
          <svg viewBox="0 0 24 24" width="18" height="18">
            <circle cx="11" cy="11" r="7" fill="none" stroke="currentColor" strokeWidth="2" />
            <path d="m20 20-3.5-3.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
        </button>
      </form>
      <div className="account">
        <InstallButton />
        {user ? (
          <>
            {notes && <Bell notes={notes} />}
            <span className={`tier-pill tier-${user.tier}`}>{TIER_LABEL[user.tier]}</span>
            {/* The next tier up: Free → Plus, Plus → Premium (admins count as Premium). */}
            {(user.tier === 'free' || user.tier === 'plus') && (
              <Link
                className="upgrade-btn"
                to={`/membership?tier=${user.tier === 'free' ? 'plus' : 'premium'}`}
              >
                Upgrade
              </Link>
            )}
            <AccountMenu user={user} onSignOut={onSignOut} />
            <button className="text-btn" onClick={onSignOut}>
              Sign out
            </button>
          </>
        ) : (
          <button className="primary-btn" onClick={onSignIn}>
            Sign in
          </button>
        )}
      </div>
    </header>
  );
}

// The avatar opens who you're signed in as and Sign out (the only way to sign out on phones).
function AccountMenu({ user, onSignOut }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    const close = (e) => !ref.current?.contains(e.target) && setOpen(false);
    const onKey = (e) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', close);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className="account-menu-wrap" ref={ref}>
      <button
        type="button"
        className="avatar"
        aria-label="Account"
        aria-haspopup="menu"
        aria-expanded={open}
        title={user.username}
        onClick={() => setOpen((o) => !o)}
      >
        {user.username[0].toUpperCase()}
      </button>
      {open && (
        <div className="account-menu" role="menu">
          <p className="account-menu-who">
            <strong>{user.username}</strong>
            {user.email && <span className="muted small">{user.email}</span>}
            <span className="muted small">{TIER_LABEL[user.tier]} member</span>
          </p>
          <Link to="/account" role="menuitem" className="account-menu-item" onClick={() => setOpen(false)}>
            Account settings
          </Link>
          <button
            type="button"
            role="menuitem"
            className="account-menu-item"
            onClick={() => {
              setOpen(false);
              onSignOut();
            }}
          >
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}
