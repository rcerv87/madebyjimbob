import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, count, formatTime } from '../api.js';

// Studio: JimBob's own playlists (create, fill, reorder, rename, delete). Imported YouTube playlists
// are listed read-only; change those on YouTube and re-run the import.
export default function StudioPlaylists({ allVideos }) {
  const [playlists, setPlaylists] = useState(null);
  const [title, setTitle] = useState('');
  const [error, setError] = useState('');

  const load = () =>
    api('/studio/playlists')
      .then((d) => setPlaylists(d.playlists))
      .catch((e) => setError(e.message));
  useEffect(() => {
    load();
  }, []);

  const create = async (e) => {
    e.preventDefault();
    if (!title.trim()) return setError('Give the playlist a title.');
    try {
      await api('/studio/playlists', { method: 'POST', body: { title } });
      setTitle('');
      setError('');
      load();
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <section className="panel studio-playlists">
      <h2>Playlists</h2>
      <form className="new-playlist" onSubmit={create}>
        <input
          id="new-playlist-title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="New playlist title"
          aria-label="New playlist title"
          maxLength={150}
        />
        <button className="primary-btn">Create</button>
      </form>
      {error && <p className="error small">{error}</p>}
      {!playlists && <p className="muted">Loading playlists…</p>}
      {playlists?.length === 0 && <p className="muted">No playlists yet.</p>}
      <ul className="studio-playlist-list">
        {playlists?.map((p) => (
          <StudioPlaylist key={p.id} p={p} allVideos={allVideos} onChanged={load} />
        ))}
      </ul>
    </section>
  );
}

function StudioPlaylist({ p, allVideos, onChanged }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(p.title);
  const [adding, setAdding] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState('');
  const editable = p.source === 'native';
  const ids = p.videos.map((v) => String(v.id));

  const run = async (fn) => {
    setError('');
    try {
      await fn();
      onChanged();
    } catch (err) {
      setError(err.message);
    }
  };
  const saveOrder = (videoIds) =>
    run(() => api(`/studio/playlists/${p.id}/items`, { method: 'PUT', body: { videoIds } }));
  const move = (i, step) => {
    const next = [...ids];
    [next[i], next[i + step]] = [next[i + step], next[i]];
    saveOrder(next);
  };

  return (
    <li className="studio-playlist">
      <div className="studio-playlist-head">
        <button type="button" className="text-btn" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
          {open ? '▾' : '▸'} <b>{p.title}</b>
        </button>
        <span className="muted small">
          {count(p.videos.length, 'video')} · {formatTime(p.durationS)}
          {p.source === 'youtube' && ' · from YouTube'}
        </span>
        <Link to={`/playlist/${p.id}`} className="text-btn small">
          View
        </Link>
      </div>
      {open && (
        <div className="studio-playlist-body">
          {!editable && (
            <p className="muted small">
              This playlist comes from YouTube. Change it there, then run{' '}
              <code>npm run import:playlists</code> again.
            </p>
          )}
          {editable && (
            <form
              className="rename"
              onSubmit={(e) => {
                e.preventDefault();
                run(() => api(`/studio/playlists/${p.id}`, { method: 'PATCH', body: { title: name } }));
              }}
            >
              <input
                id={`playlist-title-${p.id}`}
                value={name}
                onChange={(e) => setName(e.target.value)}
                aria-label="Playlist title"
                maxLength={150}
              />
              <button className="text-btn" disabled={name.trim() === p.title}>
                Rename
              </button>
            </form>
          )}
          <ol className="studio-items">
            {p.videos.map((v, i) => (
              <li key={v.id}>
                <span className="studio-item-title">{v.title}</span>
                {editable && (
                  <span className="studio-item-actions">
                    <button
                      type="button"
                      aria-label={`Move ${v.title} up`}
                      disabled={i === 0}
                      onClick={() => move(i, -1)}
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      aria-label={`Move ${v.title} down`}
                      disabled={i === p.videos.length - 1}
                      onClick={() => move(i, 1)}
                    >
                      ↓
                    </button>
                    <button
                      type="button"
                      aria-label={`Remove ${v.title}`}
                      onClick={() => saveOrder(ids.filter((x) => x !== String(v.id)))}
                    >
                      Remove
                    </button>
                  </span>
                )}
              </li>
            ))}
          </ol>
          {editable && (
            <div className="studio-add">
              <select
                id={`playlist-add-${p.id}`}
                value={adding}
                onChange={(e) => setAdding(e.target.value)}
                aria-label="Video to add"
              >
                <option value="">Add a video…</option>
                {allVideos
                  .filter((v) => !ids.includes(String(v.id)))
                  .map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.title}
                    </option>
                  ))}
              </select>
              <button
                type="button"
                className="primary-btn"
                disabled={!adding}
                onClick={() => {
                  saveOrder([...ids, adding]);
                  setAdding('');
                }}
              >
                Add
              </button>
              <span className="spacer" />
              {confirmDelete ? (
                <span className="confirm">
                  Delete this playlist?{' '}
                  <button
                    type="button"
                    className="danger-btn"
                    onClick={() => run(() => api(`/studio/playlists/${p.id}`, { method: 'DELETE' }))}
                  >
                    Delete
                  </button>
                  <button type="button" className="text-btn" onClick={() => setConfirmDelete(false)}>
                    Keep
                  </button>
                </span>
              ) : (
                <button type="button" className="text-btn" onClick={() => setConfirmDelete(true)}>
                  Delete playlist
                </button>
              )}
            </div>
          )}
          {error && <p className="error small">{error}</p>}
        </div>
      )}
    </li>
  );
}
