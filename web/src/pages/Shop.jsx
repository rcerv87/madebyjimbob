import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../api.js';
import useTitle from '../useTitle.js';
import { BRAND, money, sized } from '../brand.js';

// JimBob's store, browsable here; checkout happens on madebyjimbob.com.
export default function Shop() {
  const [params, setParams] = useSearchParams();
  useTitle('Shop');
  const collection = params.get('c') || 'all';
  const [collections, setCollections] = useState([]);
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api('/shop/collections')
      .then((d) => setCollections(d.collections))
      .catch(() => {});
  }, []);

  useEffect(() => {
    let cancelled = false;
    setData(null);
    setError('');
    api(`/shop?collection=${encodeURIComponent(collection)}`)
      .then((d) => !cancelled && setData(d))
      .catch((e) => !cancelled && setError(e.message));
    return () => {
      cancelled = true;
    };
  }, [collection]);

  const pick = (handle) => setParams(handle === 'all' ? {} : { c: handle }, { replace: true });

  return (
    <div className="library shop">
      <header className="section-head">
        <div>
          <h1>Shop</h1>
          <p className="muted">
            Books, shirts, stickers, and prints from JimBob’s store. Checkout opens on madebyjimbob.com.
          </p>
        </div>
        <a className="text-btn store-link" href={BRAND.store} target="_blank" rel="noopener noreferrer">
          Open the full store ↗
        </a>
      </header>

      <div className="chips" role="group" aria-label="Collections">
        {collections.map((c) => (
          <button
            key={c.handle}
            type="button"
            className="chip"
            aria-pressed={collection === c.handle}
            onClick={() => pick(c.handle)}
          >
            {c.label}
          </button>
        ))}
      </div>

      {error && <p className="error page-msg">{error}</p>}
      {!data && !error && <p className="muted page-msg">Loading the store…</p>}
      {data?.products.length === 0 && <p className="muted page-msg">Nothing in this collection right now.</p>}
      {data?.products.length > 0 && (
        <section className="product-grid">
          {data.products.map((p) => (
            <ProductCard key={p.id} p={p} />
          ))}
        </section>
      )}
    </div>
  );
}

export function ProductCard({ p }) {
  return (
    <a className="product" href={p.url} target="_blank" rel="noopener noreferrer">
      <span className="product-img">
        {p.image ? (
          <img
            src={sized(p.image, 480)}
            srcSet={`${sized(p.image, 480)} 480w, ${sized(p.image, 800)} 800w`}
            sizes="(max-width: 600px) 50vw, 240px"
            alt=""
            loading="lazy"
          />
        ) : null}
        {!p.available && <span className="sold-out">Sold out</span>}
        {p.compareAt && p.available && <span className="on-sale">Sale</span>}
      </span>
      <span className="product-title">{p.title}</span>
      <span className="product-price">
        {p.priceVaries && 'From '}
        {money(p.price)}
        {p.compareAt && <s>{money(p.compareAt)}</s>}
      </span>
    </a>
  );
}
