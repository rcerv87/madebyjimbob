import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../api.js';
import VideoCard from '../components/VideoCard.jsx';

export default function Home() {
  const [videos, setVideos] = useState(null);
  const [error, setError] = useState('');
  const [params] = useSearchParams();
  const q = (params.get('q') || '').toLowerCase();

  useEffect(() => {
    api('/videos')
      .then((d) => setVideos(d.videos))
      .catch((e) => setError(e.message));
  }, []);

  if (error) return <p className="error page-msg">Couldn’t load videos: {error}</p>;
  if (!videos) return <p className="muted page-msg">Loading streams…</p>;

  const shown = q ? videos.filter((v) => v.title.toLowerCase().includes(q)) : videos;

  if (!videos.length) {
    return (
      <div className="page-msg">
        <h2>No streams yet</h2>
        <p className="muted">
          Import a past stream with <code>npm run import:youtube -- &lt;youtube-url&gt;</code> and it will
          show up here.
        </p>
      </div>
    );
  }

  return (
    <>
      {q && (
        <p className="muted results-for">
          {shown.length} result{shown.length === 1 ? '' : 's'} for “{params.get('q')}”
        </p>
      )}
      <section className="grid">
        {shown.map((v) => (
          <VideoCard key={v.id} v={v} />
        ))}
      </section>
    </>
  );
}
