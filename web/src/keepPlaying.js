import { useEffect, useRef, useState } from 'react';
import { matchPath, useLocation, useNavigate } from 'react-router-dom';

// Browsers pause a video once it leaves the page, so a video in the Mini player (picture-in-picture)
// would stop as soon as the viewer opened another page. While it's in the Mini player, the watch page
// stays mounted (hidden) under the other pages. Returns the watch page's location to render (null when
// there's none) and whether it's in the background.
export function useKeepPlaying() {
  const location = useLocation();
  const navigate = useNavigate();
  const onWatch = Boolean(matchPath('/watch/:id', location.pathname));
  const [lastWatch, setLastWatch] = useState(null);
  const [inPip, setInPip] = useState(false);
  if (onWatch && lastWatch !== location) setLastWatch(location);

  const latest = useRef({});
  latest.current = { onWatch, lastWatch };

  useEffect(() => {
    const enter = () => setInPip(true);
    const leave = (e) => {
      const video = e.target;
      // Closing the Mini player pauses the video; "Back to tab" keeps it playing, so show its page again.
      setTimeout(() => {
        const { onWatch: showing, lastWatch: back } = latest.current;
        if (!showing && back && !video.paused) navigate(back);
        setInPip(false);
      }, 150);
    };
    // Capture: these events are fired at the <video>.
    document.addEventListener('enterpictureinpicture', enter, true);
    document.addEventListener('leavepictureinpicture', leave, true);
    return () => {
      document.removeEventListener('enterpictureinpicture', enter, true);
      document.removeEventListener('leavepictureinpicture', leave, true);
    };
  }, [navigate]);

  const watchAt = onWatch ? location : inPip ? lastWatch : null;
  return { watchAt, background: !onWatch };
}
