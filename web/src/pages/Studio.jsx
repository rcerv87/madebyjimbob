import { useCallback, useEffect, useState } from 'react';
import { Link, NavLink, useLocation } from 'react-router-dom';
import { api, compact, count, formatTime, TIER_LABEL } from '../api.js';
import StudioPlaylists from '../components/StudioPlaylists.jsx';
import StudioEmail from '../components/StudioEmail.jsx';
import StudioLinks from '../components/StudioLinks.jsx';
import StudioReports from '../components/StudioReports.jsx';
import StudioMembers from '../components/StudioMembers.jsx';
import StudioSuperchats from '../components/StudioSuperchats.jsx';
import StudioLive from '../components/StudioLive.jsx';
import StudioImports from '../components/StudioImports.jsx';
import StudioVideoActions from '../components/StudioVideoActions.jsx';
import useTitle from '../useTitle.js';

// Studio's sections, each at its own address (/studio/<id>) so a refresh or a shared link lands on the same one.
const TABS = [
  ['overview', 'Overview'],
  ['live', 'Live'],
  ['videos', 'Videos'],
  ['add', 'Add videos'],
  ['members', 'Members'],
  ['reports', 'Reports'],
  ['email', 'Email'],
];

export default function Studio({ user }) {
  const section = useLocation().pathname.split('/')[2] || 'overview';
  const tab = TABS.some(([id]) => id === section) ? section : 'overview';
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [saveError, setSaveError] = useState('');
  useTitle('Studio');

  const load = useCallback(
    () =>
      api('/studio/overview')
        .then(setData)
        .catch((e) => setError(e.message)),
    [],
  );
  // Loaded on arrival and again each time Overview is opened, so its counts are current.
  const onOverview = tab === 'overview';
  useEffect(() => {
    setError('');
    if (user?.isAdmin) load();
  }, [user?.isAdmin, load, onOverview]);

  // Bulk actions on the Content table: tick videos (or all), then change access or delete them together.
  const [picked, setPicked] = useState(() => new Set());
  const [bulk, setBulk] = useState({ confirm: false, files: true, tier: 'free', progress: '' });
  const toggle = (id) =>
    setPicked((p) => {
      const next = new Set(p);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const runBulk = async (label, ids, call) => {
    setSaveError('');
    const failed = [];
    for (let i = 0; i < ids.length; i += 1) {
      setBulk((b) => ({ ...b, progress: `${label} ${i + 1} of ${ids.length}…` }));
      try {
        await call(ids[i]);
      } catch (e) {
        failed.push(`${data.videos.find((v) => v.id === ids[i])?.title || ids[i]}: ${e.message}`);
      }
    }
    setBulk((b) => ({ ...b, confirm: false, progress: '' }));
    setPicked(new Set());
    if (failed.length) setSaveError(`Some didn't go through: ${failed.join('; ')}`);
    load();
  };
  const bulkDelete = () =>
    runBulk('Deleting', [...picked], (id) =>
      api(`/studio/videos/${id}`, { method: 'DELETE', body: { removeFromStream: bulk.files } }),
    );
  const bulkTier = () =>
    runBulk('Updating', [...picked], (id) =>
      api(`/studio/videos/${id}`, { method: 'PATCH', body: { minTier: bulk.tier } }),
    );

  const setTier = async (id, minTier) => {
    setSaveError('');
    try {
      await api(`/studio/videos/${id}`, { method: 'PATCH', body: { minTier } });
      load();
    } catch (e) {
      setSaveError(`Couldn't change access: ${e.message}`);
    }
  };

  if (!user) return <p className="muted page-msg">Sign in with a Studio account to see the dashboard.</p>;
  if (!user.isAdmin) return <p className="error page-msg">Studio is only for JimBob and mods.</p>;
  if (error) return <p className="error page-msg">{error}</p>;
  if (!data) return <p className="muted page-msg">Loading Studio…</p>;
  const t = data.totals;
  const a = data.attention || {};
  const m = data.members;
  // What's waiting on someone, each with the tab that deals with it.
  const todo = [
    a.openReports > 0 && ['reports', `${count(a.openReports, 'report')} to look at`],
    a.pendingLinks > 0 && [
      'members',
      `${count(a.pendingLinks, 'linked-account request')} waiting for a yes or no`,
    ],
    a.failedImports > 0 && ['add', `${count(a.failedImports, 'import')} failed`],
    a.queuedImports > 0 && ['add', `${count(a.queuedImports, 'import')} in the queue`],
  ].filter(Boolean);
  const badge = { reports: a.openReports, members: a.pendingLinks, add: a.failedImports };

  return (
    <div className="studio">
      <h1>Studio</h1>
      <nav className="library-tabs studio-tabs" aria-label="Studio sections">
        {TABS.map(([id, label]) => (
          <NavLink
            key={id}
            to={id === 'overview' ? '/studio' : `/studio/${id}`}
            end
            className={({ isActive }) => `library-tab ${isActive ? 'active' : ''}`}
          >
            {label}
            {badge[id] > 0 && <span className="tab-count">{badge[id]}</span>}
          </NavLink>
        ))}
      </nav>

      {tab === 'overview' && (
        <>
          <section className="stats">
            <Stat label="Videos" value={t.videos} />
            <Stat label="Views" value={t.views} />
            <Stat label="Unique chatters" value={t.chatters} />
            <Stat label="YouTube chat" value={t.youtubeMsgs} />
            <Stat label="Platform chat" value={t.nativeMsgs} />
            <Stat label="Super chats" value={t.paidMsgs} accent />
          </section>
          <div className="studio-cols">
            <div className="studio-stack">
              <section className="panel">
                <h2>Needs attention</h2>
                {todo.length ? (
                  <ul className="activity-list">
                    {todo.map(([to, text]) => (
                      <li key={text}>
                        <span>{text}</span>
                        <Link to={`/studio/${to}`}>Open</Link>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="muted small">Nothing is waiting on you.</p>
                )}
              </section>
              {m && (
                <section className="panel">
                  <div className="setting-head">
                    <h2>Members</h2>
                    <Link to="/studio/members">See everyone</Link>
                  </div>
                  <section className="stats compact">
                    <Stat label="Accounts" value={m.total} />
                    <Stat label="New this week" value={m.newThisWeek} />
                    <Stat label="Plus and Premium" value={m.paying} accent />
                  </section>
                </section>
              )}
            </div>
            <section className="panel">
              <h2>Top chatters</h2>
              <ol className="leaderboard">
                {data.topChatters.map((c, i) => (
                  <li key={`${c.author}-${c.source}`}>
                    <span className="rank">{i + 1}</span>
                    <span className="lb-name">{c.author}</span>
                    <span className={`source-tag ${c.source}`}>{c.source === 'youtube' ? 'YT' : 'JB'}</span>
                    <span className="lb-count">{compact(c.msgs)}</span>
                  </li>
                ))}
                {!data.topChatters.length && <li className="muted">No chat yet.</li>}
              </ol>
            </section>
          </div>
        </>
      )}

      {tab === 'live' && (
        <>
          <StudioLive />
          <StudioSuperchats />
        </>
      )}

      {tab === 'add' && <StudioImports onImported={load} />}

      {tab === 'members' && (
        <>
          <StudioMembers user={user} />
          <StudioLinks />
        </>
      )}

      {tab === 'reports' && <StudioReports />}

      {tab === 'email' && <StudioEmail />}

      {tab === 'videos' && (
        <>
          <section className="panel studio-content">
            <h2>Content</h2>
            {saveError && <p className="error small">{saveError}</p>}
            {picked.size > 0 && (
              <div className="bulk-bar" role="region" aria-label="Selected videos">
                <strong>{picked.size} selected</strong>
                {bulk.progress ? (
                  <span className="small">{bulk.progress}</span>
                ) : bulk.confirm ? (
                  <>
                    <span className="small">
                      Delete {picked.size} video{picked.size === 1 ? '' : 's'} with their chat and comments?
                    </span>
                    <label className="check small">
                      <input
                        type="checkbox"
                        checked={bulk.files}
                        onChange={(e) => setBulk((b) => ({ ...b, files: e.target.checked }))}
                      />
                      Also delete the video files (Cloudflare Stream and replay recordings in R2)
                    </label>
                    <button type="button" className="danger-btn small" onClick={bulkDelete}>
                      Delete {picked.size}
                    </button>
                    <button
                      type="button"
                      className="text-btn small"
                      onClick={() => setBulk((b) => ({ ...b, confirm: false }))}
                    >
                      Cancel
                    </button>
                  </>
                ) : (
                  <>
                    <label className="small">
                      Access{' '}
                      <select
                        value={bulk.tier}
                        onChange={(e) => setBulk((b) => ({ ...b, tier: e.target.value }))}
                        aria-label="Access for the selected videos"
                      >
                        {Object.entries(TIER_LABEL).map(([k, l]) => (
                          <option key={k} value={k}>
                            {l}
                          </option>
                        ))}
                      </select>
                    </label>
                    <button type="button" className="primary-btn small" onClick={bulkTier}>
                      Apply
                    </button>
                    <button
                      type="button"
                      className="text-btn small danger-text"
                      onClick={() => setBulk((b) => ({ ...b, confirm: true }))}
                    >
                      Delete…
                    </button>
                    <button type="button" className="text-btn small" onClick={() => setPicked(new Set())}>
                      Clear
                    </button>
                  </>
                )}
              </div>
            )}
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>
                      <input
                        type="checkbox"
                        aria-label="Select all videos"
                        checked={data.videos.length > 0 && picked.size === data.videos.length}
                        onChange={(e) =>
                          setPicked(e.target.checked ? new Set(data.videos.map((v) => v.id)) : new Set())
                        }
                      />
                    </th>
                    <th>Video</th>
                    <th>Length</th>
                    <th>Views</th>
                    <th>YT chat</th>
                    <th>Our chat</th>
                    <th>Super chats</th>
                    <th>Likes</th>
                    <th>Dislikes</th>
                    <th>Access</th>
                  </tr>
                </thead>
                <tbody>
                  {data.videos.map((v) => (
                    <tr key={v.id} className={picked.has(v.id) ? 'picked' : undefined}>
                      <td>
                        <input
                          type="checkbox"
                          aria-label={`Select ${v.title}`}
                          checked={picked.has(v.id)}
                          onChange={() => toggle(v.id)}
                        />
                      </td>
                      <td className="title-cell">
                        <Link to={`/watch/${v.id}`}>{v.title}</Link>
                        <StudioVideoActions video={v} onChanged={load} />
                      </td>
                      <td>{v.durationS ? formatTime(v.durationS) : '—'}</td>
                      <td>{compact(v.views)}</td>
                      <td>{compact(v.youtubeMsgs)}</td>
                      <td>{compact(v.nativeMsgs)}</td>
                      <td>{v.paidMsgs}</td>
                      <td>{compact(v.likes ?? 0)}</td>
                      <td>{compact(v.dislikes ?? 0)}</td>
                      <td>
                        <select
                          value={v.minTier}
                          onChange={(e) => setTier(v.id, e.target.value)}
                          aria-label={`Access for ${v.title}`}
                        >
                          {Object.entries(TIER_LABEL).map(([k, l]) => (
                            <option key={k} value={k}>
                              {l}
                            </option>
                          ))}
                        </select>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <StudioPlaylists allVideos={data.videos} />
        </>
      )}
    </div>
  );
}

function Stat({ label, value, accent }) {
  return (
    <div className={`stat ${accent ? 'accent' : ''}`}>
      <span className="stat-value">{compact(value)}</span>
      <span className="stat-label">{label}</span>
    </div>
  );
}
