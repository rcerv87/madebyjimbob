import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { onAppResume } from '../native.js';

const EVERY_MS = 30_000;

// A LIVE strip on the home page while JimBob is streaming on the platform (ADR-004). It asks every 30 seconds, only
// while it can be seen: a background tab or a backgrounded app doesn't ask, and coming back asks right away.
export default function LiveBanner() {
  const [online, setOnline] = useState(false);
  useEffect(() => {
    let gone = false;
    let asking = false;
    let timer = null;
    const hidden = () => typeof document !== 'undefined' && document.visibilityState === 'hidden';
    const load = () => {
      if (gone || asking || hidden()) return;
      asking = true;
      api('/live')
        .then((d) => !gone && setOnline(Boolean(d.online)))
        .catch(() => {})
        .finally(() => {
          asking = false;
        });
    };
    const schedule = () => {
      clearInterval(timer);
      timer = hidden() ? null : setInterval(load, EVERY_MS);
    };
    const onVisibility = () => {
      schedule();
      load();
    };
    load();
    schedule();
    document.addEventListener('visibilitychange', onVisibility);
    let stopResume = () => {};
    onAppResume(onVisibility).then((stop) => (gone ? stop() : (stopResume = stop)));
    return () => {
      gone = true;
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisibility);
      stopResume();
    };
  }, []);
  if (!online) return null;
  return (
    <Link className="live-banner" to="/live">
      <span className="live-badge">LIVE</span>
      <span>JimBob is live now. Tap to watch.</span>
    </Link>
  );
}
