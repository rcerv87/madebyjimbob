import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';

// A LIVE strip on the home page while JimBob is streaming on the platform (ADR-004).
export default function LiveBanner() {
  const [online, setOnline] = useState(false);
  useEffect(() => {
    let stop = false;
    const load = () =>
      api('/live')
        .then((d) => !stop && setOnline(Boolean(d.online)))
        .catch(() => {});
    load();
    const t = setInterval(load, 30000);
    return () => {
      stop = true;
      clearInterval(t);
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
