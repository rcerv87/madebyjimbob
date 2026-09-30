import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, count, formatTime } from '../api.js';
import VideoCard from '../components/VideoCard.jsx';

export default function Playlist() {
  const { id } = useParams();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    setData(null);
    setError('');
    api(`/playlists/${id}`)
      .then(setData)
      .catch((e) => setError(e.message));
  }, [id]);

  if (error) return <p className="error page-msg">{error}</p>;
  if (!data) return <p className="muted page-msg">Loading playlist…</p>;
  const { playlist, videos } = data;

  return (
    <div className="library">
      <header className="playlist-head">
        <p className="eyebrow">
          <Link to="/playlists">Playlists</Link>
        </p>
        <h1>{playlist.title}</h1>
        <p className="muted">
          {count(videos.length, 'video')} · {formatTime(playlist.durationS)} total
          {playlist.source === 'youtube' ? ' · from YouTube' : ''}
        </p>
        {playlist.description && <p className="playlist-desc">{playlist.description}</p>}
        {videos.length > 0 && (
          <Link className="primary-btn play-all" to={`/watch/${videos[0].id}?list=${playlist.id}`}>
            ▶ Play all
          </Link>
        )}
      </header>
      <section className="grid">
        {videos.map((v, i) => (
          <VideoCard key={v.id} v={v} to={`/watch/${v.id}?list=${playlist.id}`} position={i + 1} />
        ))}
      </section>
    </div>
  );
}
