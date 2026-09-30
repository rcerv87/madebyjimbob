import { useEffect, useRef, useState } from 'react';
import { api } from '../api.js';
import useTitle from '../useTitle.js';
import { money, sized } from '../brand.js';

// JimBob's art: originals, prints, and digital pieces from his store, as a gallery. Tap a piece to
// see it large; "View in store" opens it on madebyjimbob.com.
export default function Art() {
  const [pieces, setPieces] = useState(null);
  useTitle('Art');
  const [error, setError] = useState('');
  const [open, setOpen] = useState(null);
  const [filter, setFilter] = useState('All');

  useEffect(() => {
    api('/art')
      .then((d) => setPieces(d.pieces))
      .catch((e) => setError(e.message));
  }, []);

  const kinds = pieces ? ['All', ...new Set(pieces.map((p) => p.collection))] : [];
  const shown = pieces?.filter((p) => filter === 'All' || p.collection === filter) || [];

  return (
    <div className="library art">
      <header className="section-head">
        <div>
          <h1>Art</h1>
          <p className="muted">JimBob’s illustrations and comics: originals, prints, and digital pieces.</p>
        </div>
      </header>
      {kinds.length > 2 && (
        <div className="chips" role="group" aria-label="Kind of art">
          {kinds.map((k) => (
            <button
              key={k}
              type="button"
              className="chip"
              aria-pressed={filter === k}
              onClick={() => setFilter(k)}
            >
              {k}
            </button>
          ))}
        </div>
      )}
      {error && <p className="error page-msg">{error}</p>}
      {!pieces && !error && <p className="muted page-msg">Loading the gallery…</p>}
      {pieces?.length === 0 && <p className="muted page-msg">No art in the store right now.</p>}
      <section className="art-grid">
        {shown.map((p) => (
          <button key={p.id} type="button" className="art-piece" onClick={() => setOpen(p)}>
            {p.image && <img src={sized(p.image, 600)} alt={p.title} loading="lazy" />}
            <span className="art-caption">{p.title}</span>
          </button>
        ))}
      </section>
      {open && <ArtViewer piece={open} onClose={() => setOpen(null)} />}
    </div>
  );
}

function ArtViewer({ piece, onClose }) {
  const closeRef = useRef(null);
  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="art-viewer" role="dialog" aria-modal="true" aria-label={piece.title} onClick={onClose}>
      <figure onClick={(e) => e.stopPropagation()}>
        {piece.image && <img src={sized(piece.image, 1600)} alt={piece.title} />}
        <figcaption>
          <div>
            <b>{piece.title}</b>
            <span className="muted small">
              {piece.collection}
              {piece.price !== null && ` · ${piece.priceVaries ? 'from ' : ''}${money(piece.price)}`}
              {!piece.available && ' · Sold out'}
            </span>
          </div>
          <div className="art-actions">
            <a className="primary-btn" href={piece.url} target="_blank" rel="noopener noreferrer">
              View in store ↗
            </a>
            <button type="button" className="text-btn" onClick={onClose} ref={closeRef}>
              Close
            </button>
          </div>
        </figcaption>
      </figure>
    </div>
  );
}
