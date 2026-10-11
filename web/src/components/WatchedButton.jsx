import { useState } from 'react';
import { markWatched, markUnwatched, watchState, readLocal } from '../progress.js';

// On a video's page (MBJ-814): mark it watched or unwatched by hand. Watched puts your place at the end, so it
// leaves Unwatched and the binge queue; unwatched puts it back at the start.
export default function WatchedButton({ video }) {
  const [state, setState] = useState(() =>
    watchState(video.resumeMs ?? readLocal(video.id) ?? 0, video.durationS),
  );
  const watched = state === 'watched';
  // Without a known length there's no "end" to mark.
  if (!video.durationS) return null;
  return (
    <button
      type="button"
      className="like-btn"
      aria-pressed={watched}
      onClick={() => {
        if (watched) markUnwatched(video);
        else markWatched(video);
        setState(watched ? 'unwatched' : 'watched');
      }}
    >
      {watched ? '✓ Watched' : 'Mark as watched'}
    </button>
  );
}
