import { useEffect, useState } from 'react';
import { api, compact } from '../api.js';

// Thumbs up (with the count) and thumbs down (count only in Studio), like YouTube.
// Tapping your current vote again clears it.
export default function LikeButtons({ videoId, likes: initialLikes = 0, myVote: initialVote = 0, session }) {
  const [likes, setLikes] = useState(initialLikes);
  const [vote, setVote] = useState(initialVote);
  const [error, setError] = useState('');

  useEffect(() => {
    setLikes(initialLikes);
    setVote(initialVote);
  }, [videoId, initialLikes, initialVote]);

  const cast = async (value) => {
    if (!session?.user) return session?.requireSignIn?.();
    const next = vote === value ? 0 : value;
    const before = { likes, vote };
    // Show it right away; undo if the server says no.
    setVote(next);
    setLikes(likes + (next === 1) - (vote === 1));
    setError('');
    try {
      const r = await api(`/videos/${videoId}/vote`, { method: 'POST', body: { value: next } });
      setLikes(r.likes);
      setVote(r.myVote);
    } catch (err) {
      setLikes(before.likes);
      setVote(before.vote);
      setError(err.message);
    }
  };

  return (
    <div className="likes" role="group" aria-label="Rate this video">
      <button
        type="button"
        className="like-btn up"
        aria-pressed={vote === 1}
        aria-label={`Like (${likes})`}
        title="I like this"
        onClick={() => cast(1)}
      >
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
          <path
            d="M7 10v11H3V10zm2 11V10l4.5-8 1.2.6a2 2 0 0 1 1 2.3L14.8 9H20a2 2 0 0 1 2 2.3l-1.4 8A2 2 0 0 1 18.6 21z"
            fill={vote === 1 ? 'currentColor' : 'none'}
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinejoin="round"
          />
        </svg>
        <span>{compact(likes)}</span>
      </button>
      <button
        type="button"
        className="like-btn down"
        aria-pressed={vote === -1}
        aria-label="Dislike"
        title="I dislike this"
        onClick={() => cast(-1)}
      >
        <svg
          viewBox="0 0 24 24"
          width="18"
          height="18"
          aria-hidden="true"
          style={{ transform: 'scaleY(-1)' }}
        >
          <path
            d="M7 10v11H3V10zm2 11V10l4.5-8 1.2.6a2 2 0 0 1 1 2.3L14.8 9H20a2 2 0 0 1 2 2.3l-1.4 8A2 2 0 0 1 18.6 21z"
            fill={vote === -1 ? 'currentColor' : 'none'}
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinejoin="round"
          />
        </svg>
      </button>
      {error && (
        <span className="like-error" role="alert">
          {error}
        </span>
      )}
    </div>
  );
}
