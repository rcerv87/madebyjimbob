import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { TIER_LABEL } from '../api.js';

export default function TopBar({ user, onSignIn, onSignOut, onMenu }) {
  const [params] = useSearchParams();
  const [q, setQ] = useState(params.get('q') || '');
  const navigate = useNavigate();

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
        <span className="brand-mark">JB</span>
        <span className="brand-name">MadeByJimBob</span>
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
        {user ? (
          <>
            <span className={`tier-pill tier-${user.tier}`}>{TIER_LABEL[user.tier]}</span>
            <span className="avatar" title={user.username}>
              {user.username[0].toUpperCase()}
            </span>
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
