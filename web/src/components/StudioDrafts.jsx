import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, formatTime, TIER_LABEL } from '../api.js';

// Studio → Videos → Drafts (MBJ-818): videos the Library Uploader sent from the "Not on YouTube" folder. Nobody
// but Studio accounts can see a draft; each gets a title and who can watch, then Publish (or Delete).
export default function StudioDrafts({ drafts, onChanged }) {
  if (!drafts.length) return null;
  return (
    <section className="panel studio-drafts">
      <h2>Drafts ({drafts.length})</h2>
      <p className="muted small">
        Videos uploaded from your “Not on YouTube” folder. Only Studio accounts can see them until you
        publish. The title starts as the file’s name.
      </p>
      <ul className="device-list">
        {drafts.map((v) => (
          <Draft key={v.id} video={v} onChanged={onChanged} />
        ))}
      </ul>
    </section>
  );
}

function Draft({ video, onChanged }) {
  const [title, setTitle] = useState(video.title);
  const [tier, setTier] = useState(video.minTier);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const run = async (call) => {
    setError('');
    try {
      setBusy(true);
      await call();
      onChanged();
    } catch (e) {
      setError(e.message);
      setBusy(false);
    }
  };
  const publish = (e) => {
    e.preventDefault();
    run(() =>
      api(`/studio/videos/${video.id}`, {
        method: 'PATCH',
        body: { title: title.trim(), minTier: tier, draft: false },
      }),
    );
  };
  const remove = () =>
    run(() => api(`/studio/videos/${video.id}`, { method: 'DELETE', body: { removeFromStream: true } }));

  return (
    <li>
      <form className="draft-form" onSubmit={publish}>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          aria-label={`Title for ${video.title}`}
          maxLength={300}
          required
        />
        <span className="muted small">
          {video.durationS ? formatTime(video.durationS) : 'Length unknown'} ·{' '}
          <Link to={`/watch/${video.id}`}>Preview</Link>
        </span>
        <div className="form-actions">
          <select
            value={tier}
            onChange={(e) => setTier(e.target.value)}
            aria-label={`Access for ${video.title}`}
          >
            {Object.entries(TIER_LABEL).map(([k, l]) => (
              <option key={k} value={k}>
                {l}
              </option>
            ))}
          </select>
          <button className="primary-btn small" disabled={busy || !title.trim()}>
            Publish
          </button>
          {confirming ? (
            <>
              <button type="button" className="danger-btn small" onClick={remove} disabled={busy}>
                Delete it
              </button>
              <button type="button" className="text-btn small" onClick={() => setConfirming(false)}>
                Keep
              </button>
            </>
          ) : (
            <button type="button" className="text-btn small danger-text" onClick={() => setConfirming(true)}>
              Delete…
            </button>
          )}
        </div>
        {error && (
          <p className="error small" role="alert">
            {error}
          </p>
        )}
      </form>
    </li>
  );
}
