import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../api.js';
import useTitle from '../useTitle.js';
import VideoCard from '../components/VideoCard.jsx';
import LibraryTabs from '../components/LibraryTabs.jsx';
import BrandHero from '../components/BrandHero.jsx';

// Filter chips: start from everything, narrow by type or members-only. Kept in the URL so a
// filtered view can be shared or bookmarked.
const CHIPS = [
  { key: 'all', label: 'All' },
  { key: 'video', label: 'Videos' },
  { key: 'short', label: 'Shorts' },
  { key: 'live', label: 'Live' },
  { key: 'members', label: 'Members only' },
];

export default function Home() {
  const [params, setParams] = useSearchParams();
  useTitle(null);
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const q = params.get('q') || '';
  const sort = params.get('sort') || 'new';
  const chip = params.get('members') === '1' ? 'members' : params.get('kind') || 'all';

  // Late answers for an earlier filter are dropped, so quick chip taps can't show the wrong list.
  useEffect(() => {
    let cancelled = false;
    const query = new URLSearchParams();
    if (q) query.set('q', q);
    if (sort !== 'new') query.set('sort', sort);
    if (chip === 'members') query.set('members', '1');
    else if (chip !== 'all') query.set('kind', chip);
    setError('');
    api(`/videos?${query}`)
      .then((d) => !cancelled && setData(d))
      .catch((e) => !cancelled && setError(e.message));
    return () => {
      cancelled = true;
    };
  }, [q, sort, chip]);

  const update = (changes) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(changes)) {
      if (v === null || v === '') next.delete(k);
      else next.set(k, v);
    }
    setParams(next, { replace: true });
  };

  const pickChip = (key) =>
    update({
      kind: key === 'all' || key === 'members' ? null : key,
      members: key === 'members' ? '1' : null,
    });

  return (
    <div className="library">
      {!q && <BrandHero />}
      <LibraryTabs />
      <div className="library-bar">
        <div className="chips" role="group" aria-label="Filter videos">
          {CHIPS.map((c) => (
            <button
              key={c.key}
              type="button"
              className="chip"
              aria-pressed={chip === c.key}
              onClick={() => pickChip(c.key)}
            >
              {c.label}
              {data?.counts && <span className="chip-count">{data.counts[c.key]}</span>}
            </button>
          ))}
        </div>
        <label className="sort-pick">
          <span className="sr-only">Sort videos</span>
          <select
            id="video-sort"
            value={sort}
            onChange={(e) => update({ sort: e.target.value === 'new' ? null : e.target.value })}
          >
            <option value="new">Newest</option>
            <option value="old">Oldest</option>
            <option value="views">Most viewed</option>
          </select>
        </label>
      </div>

      {q && (
        <p className="muted results-for">
          {data ? `${data.videos.length} result${data.videos.length === 1 ? '' : 's'}` : 'Searching'} for “{q}
          ”{' · '}
          <button type="button" className="text-btn" onClick={() => update({ q: null })}>
            Clear search
          </button>
        </p>
      )}

      {error && <p className="error page-msg">Couldn’t load videos: {error}</p>}
      {!data && !error && <p className="muted page-msg">Loading videos…</p>}
      {data && data.videos.length === 0 && !data.counts?.all && !q && (
        <div className="page-msg">
          <h2>No streams yet</h2>
          <p className="muted">
            Import a past stream with <code>npm run import:youtube -- &lt;youtube-url&gt;</code> and it will
            show up here.
          </p>
        </div>
      )}
      {data && data.videos.length === 0 && (data.counts?.all > 0 || q) && (
        <p className="muted page-msg">Nothing matches. Try another filter or search.</p>
      )}
      {data && data.videos.length > 0 && (
        <section className="grid">
          {data.videos.map((v) => (
            <VideoCard key={v.id} v={v} />
          ))}
        </section>
      )}
    </div>
  );
}
