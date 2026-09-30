// JimBob's Shopify store (madebyjimbob.com), shown inside the platform. Reads the store's public
// product JSON (every Shopify store serves /products.json and /collections/<handle>/products.json),
// caches it for 10 minutes, and links each product back to the store for checkout.
import { logger } from './logger.js';

export const shopUrl = () => (process.env.SHOP_URL || 'https://madebyjimbob.com').replace(/\/+$/, '');

// The store's own collections, in the order its menu uses. `art: true` feeds the Art gallery.
export const COLLECTIONS = [
  { handle: 'all', label: 'All' },
  { handle: 'books', label: 'Books' },
  { handle: 'clothing', label: 'Clothing' },
  { handle: 'stickers', label: 'Stickers' },
  { handle: 'mugs', label: 'Mugs' },
  { handle: 'orthothugs', label: 'OrthoThugs' },
  { handle: 'original-art', label: 'Original art', art: true },
  { handle: 'art-prints', label: 'Art prints', art: true },
  { handle: 'classic-art-prints', label: 'Classic art prints', art: true },
  { handle: 'digital-art', label: 'Digital art', art: true },
  { handle: 'bob-chats', label: 'Bob Chats' },
];

const TTL_MS = 10 * 60 * 1000;
const cache = new Map(); // handle -> { at, products }

export function mapProduct(p, base = shopUrl()) {
  const variants = p.variants || [];
  const prices = variants.map((v) => Number(v.price)).filter(Number.isFinite);
  const compares = variants.map((v) => Number(v.compare_at_price)).filter((n) => Number.isFinite(n) && n > 0);
  const price = prices.length ? Math.min(...prices) : null;
  const compareAt = compares.length ? Math.max(...compares) : null;
  return {
    id: String(p.id),
    title: String(p.title || '').trim(),
    handle: p.handle,
    url: `${base}/products/${p.handle}`,
    type: p.product_type || '',
    price,
    priceVaries: prices.length > 1 && Math.max(...prices) !== price,
    compareAt: compareAt && price !== null && compareAt > price ? compareAt : null,
    available: variants.some((v) => v.available !== false),
    image: p.images?.[0]?.src || null,
    images: (p.images || []).slice(0, 6).map((i) => i.src),
    createdAt: p.created_at || null,
  };
}

async function fetchCollection(handle) {
  const base = shopUrl();
  const path =
    handle === 'all' ? '/products.json' : `/collections/${encodeURIComponent(handle)}/products.json`;
  const products = [];
  // Shopify pages these 250 at a time; the store has ~150, so this is usually one request.
  for (let page = 1; page <= 4; page++) {
    const res = await fetch(`${base}${path}?limit=250&page=${page}`, {
      headers: { Accept: 'application/json', 'User-Agent': 'MadeByJimBob-platform' },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(`store returned ${res.status} for ${handle}`);
    const batch = (await res.json()).products || [];
    products.push(...batch.map((p) => mapProduct(p, base)));
    if (batch.length < 250) break;
  }
  return products;
}

// Cached products for a collection. Serves the last good copy if the store is briefly unreachable.
// Requests that arrive while the store is being asked share that one request.
const pending = new Map(); // handle -> Promise
export async function collectionProducts(handle) {
  const hit = cache.get(handle);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.products;
  if (!pending.has(handle)) {
    const request = fetchCollection(handle)
      .then((products) => {
        cache.set(handle, { at: Date.now(), products });
        return products;
      })
      .finally(() => pending.delete(handle));
    pending.set(handle, request);
  }
  try {
    return await pending.get(handle);
  } catch (err) {
    if (hit) {
      logger.warn({ err, handle }, 'store unreachable; serving cached products');
      return hit.products;
    }
    throw err;
  }
}

const ART_COLLECTIONS = COLLECTIONS.filter((c) => c.art);

// The Art gallery: every art collection merged, newest first, each piece once.
export async function artPieces() {
  const lists = await Promise.all(ART_COLLECTIONS.map((c) => collectionProducts(c.handle)));
  const seen = new Map();
  lists.forEach((list, i) => {
    for (const p of list) if (!seen.has(p.id)) seen.set(p.id, { ...p, collection: ART_COLLECTIONS[i].label });
  });
  return [...seen.values()].sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}

export const clearShopCache = () => {
  cache.clear();
  pending.clear();
};
