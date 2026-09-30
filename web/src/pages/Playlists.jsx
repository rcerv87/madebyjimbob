import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, count, formatTime } from '../api.js';
import LibraryTabs from '../components/LibraryTabs.jsx';

export default function Playlists() {
  const [playlists, setPlaylists] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api('/playlists')
      .then((d) => setPlaylists(d.playlists))
      .catch((e) => setError(e.message));
  }, []);

  return (
    <div className="library">
      <LibraryTabs />
      {error && <p className="error page-msg">Couldn’t load playlists: {error}</p>}
      {!playlists && !error && <p className="muted page-msg">Loading playlists…</p>}
      {playlists?.length === 0 && (
        <div className="page-msg">
          <h2>No playlists yet</h2>
          <p className="muted">
            JimBob’s YouTube playlists appear here once imported, and he can make new ones in Studio.
          </p>
        </div>
      )}
      {playlists?.length > 0 && (
        <section className="grid">
          {playlists.map((p) => (
            <Link key={p.id} to={`/playlist/${p.id}`} className="card playlist-card">
              <div className="thumb stacked">
                {p.thumbnail ? (
                  <img src={p.thumbnail} alt="" loading="lazy" />
                ) : (
                  <div className="thumb-empty" />
                )}
                <span className="playlist-count">
                  <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
                    <path
                      d="M4 6h12M4 11h12M4 16h7M16 14v6l5-3z"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                    />
                  </svg>
                  {count(p.videoCount, 'video')}
                </span>
              </div>
              <div className="card-body">
                <h3>{p.title}</h3>
                <p className="muted small">
                  {formatTime(p.durationS)} total{p.source === 'youtube' ? ' · from YouTube' : ''}
                </p>
              </div>
            </Link>
          ))}
        </section>
      )}
    </div>
  );
}
