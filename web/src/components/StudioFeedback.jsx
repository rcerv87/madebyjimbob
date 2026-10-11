import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, formatTime, timeAgo } from '../api.js';

const NEXT = { new: 'seen', seen: 'done' };
const NEXT_LABEL = { new: 'Mark seen', seen: 'Mark done' };

// A feedback note as a backlog story to paste into the backlog (or send to whoever keeps it).
export const asStory = (f) =>
  [
    `Feedback from ${f.username}: ${f.note.split('\n')[0].slice(0, 80)}`,
    '',
    `"${f.note}"`,
    '',
    `- Page: ${f.page || 'unknown'}`,
    f.videoId &&
      `- Video: ${f.videoTitle || f.videoId}${f.offsetMs != null ? ` at ${formatTime(f.offsetMs / 1000)}` : ''}`,
    `- Device: ${f.userAgent || 'unknown'}${f.screen ? ` (${f.screen})` : ''}`,
    `- Sent: ${new Date(f.createdAt).toLocaleString()}`,
  ]
    .filter((line) => line !== null && line !== undefined && line !== false)
    .join('\n');

// A short name for the browser and device, from the user agent ("Chrome on Android").
export function deviceName(ua = '') {
  const browser = /Edg\//.test(ua)
    ? 'Edge'
    : /Firefox\//.test(ua)
      ? 'Firefox'
      : /Chrome\//.test(ua)
        ? 'Chrome'
        : /Safari\//.test(ua)
          ? 'Safari'
          : 'Browser';
  const device = /iPhone/.test(ua)
    ? 'iPhone'
    : /iPad/.test(ua)
      ? 'iPad'
      : /Android/.test(ua)
        ? 'Android'
        : /Windows/.test(ua)
          ? 'Windows'
          : /Mac OS X/.test(ua)
            ? 'Mac'
            : /Linux/.test(ua)
              ? 'Linux'
              : 'unknown device';
  return `${browser} on ${device}`;
}

// Studio → Feedback (MBJ-819): what beta testers sent from the site, as new, seen and done.
export default function StudioFeedback() {
  const [status, setStatus] = useState('new');
  const [items, setItems] = useState(null);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(null);

  const load = useCallback(
    () =>
      api(`/studio/feedback?status=${status}`)
        .then((d) => {
          setItems(d.feedback);
          setError('');
        })
        .catch((e) => setError(e.message)),
    [status],
  );
  useEffect(() => {
    load();
  }, [load]);

  const mark = async (id, next) => {
    try {
      await api(`/studio/feedback/${id}`, { method: 'POST', body: { status: next } });
      load();
    } catch (e) {
      setError(e.message);
    }
  };
  const copy = async (f) => {
    try {
      await navigator.clipboard.writeText(asStory(f));
      setCopied(f.id);
    } catch {
      setError('Copying didn’t work in this browser.');
    }
  };

  return (
    <section className="panel studio-reports">
      <div className="setting-head">
        <h2>Feedback{status === 'new' && items?.length ? ` (${items.length})` : ''}</h2>
        <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Which feedback">
          <option value="new">New</option>
          <option value="seen">Seen</option>
          <option value="done">Done</option>
        </select>
      </div>
      {error && (
        <p className="error small" role="alert">
          {error}
        </p>
      )}
      {items?.length === 0 && <p className="muted small">{status === 'new' ? 'Nothing new.' : 'None.'}</p>}
      <ul className="device-list">
        {(items || []).map((f) => (
          <li key={f.id}>
            <div>
              <Link to={`/@${f.username}`}>{f.username}</Link>
              <span className="muted small">
                {' '}
                · {timeAgo(f.createdAt)} · {deviceName(f.userAgent)}
                {f.screen ? ` · ${f.screen}` : ''}
              </span>
              <p className="report-excerpt">{f.note}</p>
              <p className="small">
                {f.videoId ? (
                  <Link
                    to={`/watch/${f.videoId}${f.offsetMs != null ? `?t=${Math.floor(f.offsetMs / 1000)}` : ''}`}
                  >
                    {f.videoTitle || 'The video'}
                    {f.offsetMs != null ? ` at ${formatTime(f.offsetMs / 1000)}` : ''}
                  </Link>
                ) : (
                  f.page && <Link to={f.page}>{f.page}</Link>
                )}
                {f.hasScreenshot && (
                  <>
                    {' '}
                    ·{' '}
                    <a href={`/api/studio/feedback/${f.id}/screenshot`} target="_blank" rel="noreferrer">
                      Screenshot
                    </a>
                  </>
                )}
              </p>
            </div>
            <div className="form-actions">
              <button type="button" className="text-btn" onClick={() => copy(f)}>
                {copied === f.id ? 'Copied' : 'Copy as a backlog story'}
              </button>
              {NEXT[f.status] ? (
                <button type="button" className="text-btn" onClick={() => mark(f.id, NEXT[f.status])}>
                  {NEXT_LABEL[f.status]}
                </button>
              ) : (
                <button type="button" className="text-btn" onClick={() => mark(f.id, 'new')}>
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
