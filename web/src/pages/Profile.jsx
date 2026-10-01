import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, formatTime, timeAgo } from '../api.js';
import MemberBadge from '../components/MemberBadge.jsx';
import NotFound from './NotFound.jsx';
import useTitle from '../useTitle.js';

// A member's public profile at /@username (MBJ-116).
export default function Profile() {
  const { handle } = useParams();
  const username = handle?.startsWith('@') ? handle.slice(1) : null;
  const [profile, setProfile] = useState(null);
  const [error, setError] = useState('');
  const [missing, setMissing] = useState(false);
  useTitle(profile ? `${profile.displayName} (@${profile.username})` : null);

  useEffect(() => {
    if (!username) return undefined;
    let cancelled = false;
    setProfile(null);
    setMissing(false);
    setError('');
    api(`/profiles/${encodeURIComponent(username)}`)
      .then((d) => !cancelled && setProfile(d.profile))
      .catch((e) => {
        if (cancelled) return;
        if (/No member/.test(e.message)) setMissing(true);
        else setError(e.message);
      });
    return () => {
      cancelled = true;
    };
  }, [username]);

  if (!username || missing) return <NotFound />;
  if (error) return <p className="error page-msg">{error}</p>;
  if (!profile) return <p className="muted page-msg">Loading…</p>;

  const at = (item, extra = '') => {
    const params = new URLSearchParams(extra);
    if (item.offsetMs != null) params.set('t', String(Math.floor(item.offsetMs / 1000)));
    const q = params.toString();
    return `/watch/${item.videoId}${q ? `?${q}` : ''}`;
  };

  return (
    <div className="profile-page">
      <header className="profile-head">
        <span className="avatar big" aria-hidden="true">
          {profile.username[0].toUpperCase()}
        </span>
        <div>
          <h1>
            {profile.displayName} <MemberBadge tier={profile.tier} />
          </h1>
          <p className="muted">
            @{profile.username} · member since{' '}
            {new Date(profile.joinedAt).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}
          </p>
          {(profile.links.youtube || profile.links.rumble) && (
            <p className="small">
              {profile.links.youtube && (
                <a
                  href={`https://www.youtube.com/${profile.links.youtube}`}
                  target="_blank"
                  rel="noreferrer"
                  className="profile-link"
                >
                  {profile.links.youtube} on YouTube
                </a>
              )}
              {profile.links.rumble && <span className="profile-link">{profile.links.rumble} on Rumble</span>}
            </p>
          )}
        </div>
      </header>

      <section className="panel">
        <h2>Comments</h2>
        {profile.comments.length === 0 && <p className="muted small">No comments yet.</p>}
        <ul className="profile-activity">
          {profile.comments.map((c) => (
            <li key={c.id}>
              <Link to={at(c, { comment: String(c.id) })} className="profile-activity-where">
                {c.videoTitle}
                {c.offsetMs != null && ` · ${formatTime(c.offsetMs / 1000)}`}
              </Link>
              <p>{c.body}</p>
              <span className="muted small">
                {c.isReply ? 'Reply · ' : ''}
                {timeAgo(c.postedAt)}
              </span>
            </li>
          ))}
        </ul>
      </section>

      {profile.showsChat && (
        <section className="panel">
          <h2>Chat</h2>
          {profile.chat.length === 0 && <p className="muted small">No chat messages yet.</p>}
          <ul className="profile-activity">
            {profile.chat.map((m) => (
              <li key={m.id}>
                <Link to={at(m, { chat: 'all' })} className="profile-activity-where">
                  {m.videoTitle} · {formatTime(m.offsetMs / 1000)}
                </Link>
                <p>{m.body}</p>
                <span className="muted small">{timeAgo(m.postedAt)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
