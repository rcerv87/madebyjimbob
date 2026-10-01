import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, timeAgo, TIER_LABEL } from '../api.js';

const STATUS_LABEL = {
  queued: 'Waiting',
  running: 'Importing',
  done: 'Done',
  failed: 'Failed',
  cancelled: 'Cancelled',
};

// Studio → Add videos (MBJ-701): paste YouTube links; the import helper on Ruben's PC (npm run import:worker)
// downloads each one and uploads it with its chat replay and comments.
export default function StudioImports({ onImported }) {
  const [data, setData] = useState(null);
  const [urls, setUrls] = useState('');
  const [tier, setTier] = useState('free');
  const [withComments, setWithComments] = useState(true);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(
    () =>
      api('/studio/imports')
        .then((d) => {
          setData((prev) => {
            const newlyDone = d.jobs.some(
              (j) => j.status === 'done' && prev?.jobs.find((p) => p.id === j.id && p.status !== 'done'),
            );
            if (newlyDone) onImported?.();
            return d;
          });
        })
        .catch((e) => setError(e.message)),
    [onImported],
  );
  useEffect(() => {
    load();
  }, [load]);
  // Follow progress while anything is waiting or importing.
  const active = data?.jobs.some((j) => j.status === 'queued' || j.status === 'running');
  useEffect(() => {
    if (!active) return undefined;
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, [active, load]);

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    setResult(null);
    setBusy(true);
    try {
      const r = await api('/studio/imports', { method: 'POST', body: { urls, tier, withComments } });
      setResult(r);
      setUrls('');
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const act = async (path, method) => {
    setError('');
    try {
      await api(path, { method });
      load();
    } catch (err) {
      setError(err.message);
    }
  };

  const helper = data?.helper;
  return (
    <section className="panel studio-imports">
      <h2>Add videos</h2>
      <p className={`small ${helper?.online ? '' : 'muted'}`}>
        {helper?.online ? (
          <>
            <span className="badge ok">Helper running</span> on {helper.name}
          </>
        ) : (
          <>
            <span className="badge">Helper not running</span> Links wait in the queue until you start it on
            your PC: <code>npm run import:worker</code>
            {helper && ` (last seen ${timeAgo(helper.lastSeen).toLowerCase()})`}
          </>
        )}
      </p>
      <form className="import-form" onSubmit={submit}>
        <textarea
          value={urls}
          onChange={(e) => setUrls(e.target.value)}
          placeholder={'YouTube video links, one per line\nhttps://www.youtube.com/watch?v=…'}
          aria-label="YouTube video links"
          rows={4}
          required
        />
        <div className="import-options">
          <label>
            Who can watch
            <select value={tier} onChange={(e) => setTier(e.target.value)}>
              {Object.entries(TIER_LABEL).map(([k, l]) => (
                <option key={k} value={k}>
                  {l}
                </option>
              ))}
            </select>
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={withComments}
              onChange={(e) => setWithComments(e.target.checked)}
            />
            Also import YouTube comments
          </label>
          <button className="primary-btn" disabled={busy}>
            {busy ? 'Adding…' : 'Add to queue'}
          </button>
        </div>
      </form>
      {result && (
        <p className="small" role="status">
          {result.queued.length} added to the queue.
          {result.skipped.length > 0 &&
            ` Skipped ${result.skipped.length}: ${result.skipped.map((s) => `${s.url} (${s.reason})`).join('; ')}.`}
        </p>
      )}
      {error && <p className="error small">{error}</p>}
      {data?.jobs.length > 0 && (
        <ul className="device-list import-jobs">
          {data.jobs.map((j) => (
            <li key={j.id}>
              <div>
                <span className={`badge ${j.status === 'done' ? 'ok' : j.status === 'failed' ? 'bad' : ''}`}>
                  {STATUS_LABEL[j.status]}
                </span>
                {j.status === 'done' && j.videoId ? (
                  <Link to={`/watch/${j.videoId}`}>{j.title || j.url}</Link>
                ) : (
                  <a href={j.url} target="_blank" rel="noreferrer">
                    {j.title || j.url}
                  </a>
                )}
                <span className="muted small">
                  {[TIER_LABEL[j.tier], j.status === 'running' && j.step, timeAgo(j.createdAt)]
                    .filter(Boolean)
                    .join(' · ')}
                </span>
                {j.status === 'failed' && j.error && <pre className="import-error">{j.error}</pre>}
              </div>
              <div className="form-actions">
                {(j.status === 'failed' || j.status === 'cancelled') && (
                  <button className="text-btn" onClick={() => act(`/studio/imports/${j.id}/retry`, 'POST')}>
                    Try again
                  </button>
                )}
                {j.status !== 'running' && (
                  <button className="text-btn" onClick={() => act(`/studio/imports/${j.id}`, 'DELETE')}>
                    {j.status === 'queued' ? 'Cancel' : 'Clear'}
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
