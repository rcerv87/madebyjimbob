import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, compact, formatTime, TIER_LABEL } from '../api.js';

export default function Studio({ user }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [saveError, setSaveError] = useState('');

  const load = () => api('/studio/overview').then(setData).catch((e) => setError(e.message));
  useEffect(() => {
    setError('');
    if (user?.isAdmin) load();
  }, [user?.isAdmin]);

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
  if (!data) return <p className="muted page-msg">Loading dashboard…</p>;
  const t = data.totals;

  return (
    <div className="studio">
      <h1>Channel dashboard</h1>

      <section className="stats">
        <Stat label="Videos" value={t.videos} />
        <Stat label="Views" value={t.views} />
        <Stat label="Unique chatters" value={t.chatters} />
        <Stat label="YouTube chat" value={t.youtubeMsgs} />
        <Stat label="Platform chat" value={t.nativeMsgs} />
        <Stat label="Super chats" value={t.paidMsgs} accent />
      </section>

      <div className="studio-cols">
        <section className="panel">
          <h2>Content</h2>
          {saveError && <p className="error small">{saveError}</p>}
          <div className="table-wrap">
            <table>
              <thead>
                <tr><th>Video</th><th>Length</th><th>Views</th><th>YT chat</th><th>Our chat</th><th>Super chats</th><th>Access</th></tr>
              </thead>
              <tbody>
                {data.videos.map((v) => (
                  <tr key={v.id}>
                    <td className="title-cell"><Link to={`/watch/${v.id}`}>{v.title}</Link></td>
                    <td>{v.durationS ? formatTime(v.durationS) : '—'}</td>
                    <td>{compact(v.views)}</td>
                    <td>{compact(v.youtubeMsgs)}</td>
                    <td>{compact(v.nativeMsgs)}</td>
                    <td>{v.paidMsgs}</td>
                    <td>
                      <select value={v.minTier} onChange={(e) => setTier(v.id, e.target.value)} aria-label={`Access for ${v.title}`}>
                        {Object.entries(TIER_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

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
