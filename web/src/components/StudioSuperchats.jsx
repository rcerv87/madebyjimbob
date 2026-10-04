import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, timeAgo } from '../api.js';
import { money } from '../membership.js';

// Studio → Super chats (MBJ-109): super chats paid on the site, newest first, refreshed every 10 s, so JimBob can read
// them on a second screen while he streams on YouTube or Rumble. Each one paid during a site stream links to its spot.
export default function StudioSuperchats() {
  const [items, setItems] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let stop = false;
    const load = () =>
      api('/studio/superchats')
        .then((d) => !stop && setItems(d.superchats))
        .catch((e) => !stop && setError(e.message));
    load();
    const t = setInterval(load, 10_000);
    return () => {
      stop = true;
      clearInterval(t);
    };
  }, []);
  const total = (items || []).reduce((sum, s) => sum + s.amountCents, 0);

  return (
    <section className="panel studio-superchats">
      <h2>
        Super chats <span className="muted small">from madebyjimbob.app/superchat and /live</span>
      </h2>
      {error && <p className="error small">{error}</p>}
      {items && items.length === 0 && (
        <p className="muted small">
          None yet. Share madebyjimbob.app/superchat in your YouTube and Rumble chats.
        </p>
      )}
      {items && items.length > 0 && (
        <>
          <p className="muted small">
            {items.length} shown · {money(total)} total
          </p>
          <ol className="superchat-list">
            {items.map((s) => (
              <li key={s.id}>
                <span className="amount">{money(s.amountCents, s.currency)}</span>
                <span>
                  <b>{s.author}</b> {s.message || <span className="muted">(no message)</span>}
                  <span className="muted small">
                    {' '}
                    · {timeAgo(s.paidAt)}
                    {s.videoId && (
                      <>
                        {' '}
                        · <Link to={`/watch/${s.videoId}`}>{s.videoTitle || 'stream'}</Link>
                      </>
                    )}
                  </span>
                </span>
              </li>
            ))}
          </ol>
        </>
      )}
    </section>
  );
}
