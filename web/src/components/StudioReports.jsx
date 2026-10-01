import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, timeAgo } from '../api.js';

const REASON = {
  spam: 'Spam or scams',
  harassment: 'Harassment',
  hate: 'Hate',
  sexual: 'Sexual content',
  violence: 'Violence or threats',
  impersonation: 'Impersonation',
  other: 'Something else',
};

// Studio → Reports (MBJ-119): what members reported, newest first. Mods mark each handled or dismissed; hiding
// messages and banning come with the moderation tools (MBJ-204).
export default function StudioReports() {
  const [status, setStatus] = useState('open');
  const [reports, setReports] = useState(null);
  const [error, setError] = useState('');

  const load = useCallback(
    () =>
      api(`/studio/reports?status=${status}`)
        .then((d) => setReports(d.reports))
        .catch((e) => setError(e.message)),
    [status],
  );
  useEffect(() => {
    load();
  }, [load]);

  const mark = async (id, next) => {
    try {
      await api(`/studio/reports/${id}`, { method: 'POST', body: { status: next } });
      load();
    } catch (err) {
      setError(err.message);
    }
  };

  const where = (r) => {
    if (!r.videoId) return null;
    const p = new URLSearchParams();
    if (r.offsetMs != null) p.set('t', String(Math.floor(r.offsetMs / 1000)));
    if (r.commentId) p.set('comment', String(r.commentId));
    else p.set('chat', 'all');
    return `/watch/${r.videoId}?${p}`;
  };

  return (
    <section className="panel studio-reports">
      <div className="setting-head">
        <h2>Reports{status === 'open' && reports?.length ? ` (${reports.length})` : ''}</h2>
        <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Which reports">
          <option value="open">Open</option>
          <option value="resolved">Handled</option>
          <option value="dismissed">Dismissed</option>
        </select>
      </div>
      {error && <p className="error small">{error}</p>}
      {reports?.length === 0 && (
        <p className="muted small">{status === 'open' ? 'Nothing to look at.' : 'None.'}</p>
      )}
      <ul className="device-list">
        {(reports || []).map((r) => (
          <li key={r.id}>
            <div>
              <span className="badge bad">{REASON[r.reason]}</span>
              <Link to={`/@${r.target}`}>{r.target}</Link>
              <span className="muted small">
                reported by {r.reporter || 'a deleted account'} · {timeAgo(r.createdAt)}
                {r.reportsOnMember > 1 && ` · ${r.reportsOnMember} reports on this member`}
              </span>
              {r.excerpt && <p className="report-excerpt small">“{r.excerpt}”</p>}
              {r.details && <p className="small muted">{r.details}</p>}
              {where(r) && (
                <Link className="small" to={where(r)}>
                  See it in the video
                </Link>
              )}
            </div>
            <div className="form-actions">
              {status === 'open' ? (
                <>
                  <button className="text-btn" onClick={() => mark(r.id, 'resolved')}>
                    Handled
                  </button>
                  <button className="text-btn" onClick={() => mark(r.id, 'dismissed')}>
                    Dismiss
                  </button>
                </>
              ) : (
                <button className="text-btn" onClick={() => mark(r.id, 'open')}>
                  Reopen
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
