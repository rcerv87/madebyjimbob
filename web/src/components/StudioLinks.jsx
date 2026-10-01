import { useEffect, useState } from 'react';
import { api, timeAgo } from '../api.js';

// Studio: Rumble names waiting for a moderator, and every linked YouTube/Rumble account (MBJ-215).
export default function StudioLinks() {
  const [links, setLinks] = useState(null);
  const [error, setError] = useState('');

  const load = () =>
    api('/studio/links')
      .then((d) => setLinks(d.links))
      .catch((e) => setError(e.message));
  useEffect(() => {
    load();
  }, []);

  const act = async (path, method) => {
    setError('');
    try {
      await api(path, { method });
      load();
    } catch (err) {
      setError(err.message);
    }
  };

  const pending = (links || []).filter((l) => l.status === 'pending');
  const linked = (links || []).filter((l) => l.status === 'verified');
  return (
    <section className="panel studio-links">
      <h2>Linked accounts</h2>
      {error && <p className="error small">{error}</p>}
      <h3>Rumble names to confirm</h3>
      {pending.length === 0 ? (
        <p className="muted small">None waiting. Members ask from Account settings → Linked accounts.</p>
      ) : (
        <ul className="device-list">
          {pending.map((l) => (
            <li key={l.id}>
              <div>
                <strong>{l.username}</strong>
                <span>says they’re {l.handle} on Rumble</span>
                <span className="muted small">asked {timeAgo(l.createdAt).toLowerCase()}</span>
              </div>
              <div className="form-actions">
                <button className="primary-btn" onClick={() => act(`/studio/links/${l.id}/approve`, 'POST')}>
                  Confirm
                </button>
                <button className="text-btn" onClick={() => act(`/studio/links/${l.id}`, 'DELETE')}>
                  Turn down
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
      <h3>Linked</h3>
      {linked.length === 0 ? (
        <p className="muted small">No linked accounts yet.</p>
      ) : (
        <ul className="device-list">
          {linked.map((l) => (
            <li key={l.id}>
              <div>
                <strong>{l.username}</strong>
                <span>
                  {l.handle} on {l.platform === 'youtube' ? 'YouTube' : 'Rumble'}
                </span>
                <span className="muted small">
                  {l.verifiedBy === 'code' ? 'posted their code' : 'confirmed by a moderator'}
                </span>
              </div>
              <button className="text-btn" onClick={() => act(`/studio/links/${l.id}`, 'DELETE')}>
                Unlink
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
