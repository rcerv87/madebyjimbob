import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, count, timeAgo, TIER_LABEL } from '../api.js';

const ROLE_LABEL = { viewer: 'Member', mod: 'Mod', admin: 'Admin' };
const FILTERS = [
  ['all', 'Everyone'],
  ['staff', 'Mods and admins'],
  ['new', 'New this week'],
  ['banned', 'Banned'],
];
const ACTION = { role: 'changed the role of', ban: 'banned', unban: 'unbanned' };

// Studio → Members (MBJ-705): find a member, change their role (admins open Studio), ban or unban them.
// Timeouts, highlights and hiding a member's messages come with the moderation tools (MBJ-204).
export default function StudioMembers({ user }) {
  const [q, setQ] = useState('');
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');
  const [tier, setTier] = useState('');
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [banning, setBanning] = useState(null); // { id, reason }

  // Search as they type, but not on every key.
  useEffect(() => {
    const t = setTimeout(() => setSearch(q.trim()), 300);
    return () => clearTimeout(t);
  }, [q]);

  const fetchPage = useCallback(
    (offset = 0) => {
      const p = new URLSearchParams({ filter, offset: String(offset) });
      if (search) p.set('q', search);
      if (tier) p.set('tier', tier);
      return api(`/studio/members?${p}`);
    },
    [search, filter, tier],
  );
  const load = useCallback(
    () =>
      fetchPage()
        .then((d) => {
          setData(d);
          setError('');
        })
        .catch((e) => setError(e.message)),
    [fetchPage],
  );
  useEffect(() => {
    load();
  }, [load]);

  const more = () =>
    fetchPage(data.members.length)
      .then((d) => setData((old) => ({ ...d, members: [...old.members, ...d.members] })))
      .catch((e) => setError(e.message));

  // Run an action, then swap in the member as the server now has them and refresh the log.
  const act = async (call) => {
    setError('');
    try {
      const { member } = await call();
      setData((old) => ({ ...old, members: old.members.map((m) => (m.id === member.id ? member : m)) }));
      setBanning(null);
      fetchPage()
        .then((d) => setData((old) => ({ ...old, actions: d.actions })))
        .catch(() => {});
    } catch (e) {
      setError(e.message);
    }
  };
  const setRole = (m, role) =>
    act(() => api(`/studio/members/${m.id}/role`, { method: 'POST', body: { role } }));
  const ban = (e) => {
    e.preventDefault();
    act(() => api(`/studio/members/${banning.id}/ban`, { method: 'POST', body: { reason: banning.reason } }));
  };
  const unban = (m) => act(() => api(`/studio/members/${m.id}/ban`, { method: 'DELETE' }));

  const members = data?.members || [];
  return (
    <section className="panel studio-members">
      <div className="setting-head">
        <h2>Members{data ? ` (${data.total})` : ''}</h2>
        <select value={tier} onChange={(e) => setTier(e.target.value)} aria-label="Membership">
          <option value="">Any membership</option>
          {Object.entries(TIER_LABEL).map(([k, l]) => (
            <option key={k} value={k}>
              {l}
            </option>
          ))}
        </select>
      </div>
      <input
        type="search"
        className="members-search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search by username, name, or full email"
        aria-label="Search members"
      />
      <div className="chips" role="group" aria-label="Which members">
        {FILTERS.map(([k, label]) => (
          <button
            key={k}
            type="button"
            className="chip"
            aria-pressed={filter === k}
            onClick={() => setFilter(k)}
          >
            {label}
          </button>
        ))}
      </div>
      {error && (
        <p className="error small" role="alert">
          {error}
        </p>
      )}
      {data && !members.length && <p className="muted small">No members match.</p>}

      <ul className="device-list">
        {members.map((m) => {
          const you = m.id === user?.id;
          return (
            <li key={m.id}>
              <div>
                <Link to={`/@${m.username}`}>{m.username}</Link>
                {you && <span className="badge">You</span>}
                {m.tier !== 'free' && <span className="badge ok">{TIER_LABEL[m.tier]}</span>}
                {(m.role !== 'viewer' || m.adminByEmail) && (
                  <span className="badge ok">{m.adminByEmail ? 'Admin' : ROLE_LABEL[m.role]}</span>
                )}
                {m.bannedAt && <span className="badge bad">Banned</span>}
                <div className="muted small">
                  {m.email || 'No email'}
                  {m.email && !m.emailVerified && ' (not confirmed)'} · joined {timeAgo(m.createdAt)} ·{' '}
                  {m.lastSeenAt ? `last seen ${timeAgo(m.lastSeenAt)}` : 'signed out'} ·{' '}
                  {count(m.chatCount, 'chat message')} · {count(m.commentCount, 'comment')}
                </div>
                {m.bannedAt && (
                  <div className="small">
                    Banned {timeAgo(m.bannedAt)}: {m.banReason}
                  </div>
                )}
                {banning?.id === m.id && (
                  <form className="ban-form" onSubmit={ban}>
                    <input
                      autoFocus
                      value={banning.reason}
                      onChange={(e) => setBanning({ id: m.id, reason: e.target.value })}
                      placeholder="Why? (only mods see this)"
                      aria-label={`Why ban ${m.username}`}
                      maxLength={500}
                    />
                    <button type="submit" className="danger-btn small" disabled={!banning.reason.trim()}>
                      Ban {m.username}
                    </button>
                    <button type="button" className="text-btn small" onClick={() => setBanning(null)}>
                      Cancel
                    </button>
                    <p className="muted small">
                      They’re signed out everywhere and can’t sign in, chat, or comment until you unban them.
                    </p>
                  </form>
                )}
              </div>
              <div className="form-actions">
                {m.adminByEmail ? (
                  <span className="muted small">Admin by site setting</span>
                ) : (
                  <select
                    value={m.role}
                    disabled={you || Boolean(m.bannedAt)}
                    onChange={(e) => setRole(m, e.target.value)}
                    aria-label={`Role for ${m.username}`}
                    title={you ? 'You can’t change your own role' : undefined}
                  >
                    {Object.entries(ROLE_LABEL).map(([k, l]) => (
                      <option key={k} value={k}>
                        {l}
                      </option>
                    ))}
                  </select>
                )}
                {m.bannedAt ? (
                  <button type="button" className="text-btn" onClick={() => unban(m)}>
                    Unban
                  </button>
                ) : (
                  !you &&
                  m.role === 'viewer' &&
                  !m.adminByEmail &&
                  banning?.id !== m.id && (
                    <button
                      type="button"
                      className="text-btn danger-text"
                      onClick={() => setBanning({ id: m.id, reason: '' })}
                    >
                      Ban…
                    </button>
                  )
                )}
              </div>
            </li>
          );
        })}
      </ul>
      {data && members.length < data.total && (
        <button type="button" className="text-btn" onClick={more}>
          Show more ({data.total - members.length} left)
        </button>
      )}

      <p className="muted small">
        Admins can open Studio and change everything in it. Mods are marked as staff (members can’t block
        them); their own tools are coming.
      </p>

      {data?.actions?.length > 0 && (
        <details className="members-log">
          <summary>Recent actions</summary>
          <ul className="activity-list">
            {data.actions.map((a) => (
              <li key={a.id}>
                <span className="small">
                  <strong>{a.actor || 'A deleted account'}</strong> {ACTION[a.action] || a.action}{' '}
                  <strong>{a.target || 'a deleted account'}</strong>
                  {a.reason && `: ${a.reason}`}
                </span>
                <span className="muted small">{timeAgo(a.createdAt)}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
