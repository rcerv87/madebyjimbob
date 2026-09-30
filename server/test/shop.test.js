import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'http';
import { startServer, stopServer, client } from './helpers.js';
import { mapProduct, clearShopCache } from '../src/shop.js';

// A stand-in for the Shopify store's public product JSON.
let hits = 0;
let storeUp = true;
const product = (id, title, handle, price, extra = {}) => ({
  id,
  title,
  handle,
  product_type: extra.type || 'T-Shirt',
  created_at: extra.createdAt || '2026-01-01T00:00:00Z',
  images: [{ src: `https://cdn.example/${handle}.jpg` }],
  variants: [
    { price: String(price), compare_at_price: extra.compareAt ?? null, available: extra.available ?? true },
  ],
});
const collections = {
  '/products.json': [
    product(1, 'Shirt', 'shirt', 30),
    product(2, 'Print A', 'print-a', 25, { type: 'Art Print' }),
  ],
  '/collections/books/products.json': [product(3, 'Savage Memes Vol. 5', 'vol-5', 40)],
  '/collections/original-art/products.json': [
    product(4, 'Original', 'original', 500, { type: 'Original Art', createdAt: '2026-05-01T00:00:00Z' }),
  ],
  '/collections/art-prints/products.json': [product(2, 'Print A', 'print-a', 25, { type: 'Art Print' })],
  '/collections/classic-art-prints/products.json': [],
  '/collections/digital-art/products.json': [],
};
let delayMs = 0;
const store = http.createServer((req, res) => {
  hits += 1;
  const path = req.url.split('?')[0];
  if (!storeUp || !collections[path]) {
    res.writeHead(storeUp ? 404 : 503);
    return res.end();
  }
  setTimeout(() => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ products: collections[path] }));
  }, delayMs);
});

let call;
before(async () => {
  await new Promise((r) => store.listen(0, '127.0.0.1', r));
  process.env.SHOP_URL = `http://127.0.0.1:${store.address().port}`;
  clearShopCache();
  const { base } = await startServer();
  call = client(base);
});
after(async () => {
  await stopServer();
  store.close();
});

test('mapProduct keeps what the shop pages need and links back to the store', () => {
  const p = mapProduct(
    {
      id: 9,
      title: ' Mug ',
      handle: 'mug',
      product_type: 'Mug',
      images: [{ src: 'a.jpg' }, { src: 'b.jpg' }],
      variants: [
        { price: '15.00', compare_at_price: '20.00', available: false },
        { price: '18.00', compare_at_price: null, available: true },
      ],
    },
    'https://madebyjimbob.com',
  );
  assert.equal(p.url, 'https://madebyjimbob.com/products/mug');
  assert.equal(p.title, 'Mug');
  assert.equal(p.price, 15);
  assert.equal(p.priceVaries, true);
  assert.equal(p.compareAt, 20);
  assert.equal(p.available, true);
  assert.deepEqual(p.images, ['a.jpg', 'b.jpg']);
});

test('lists collections and a collection’s products, cached between requests', async () => {
  const cols = await call('/shop/collections');
  assert.ok(cols.data.collections.some((c) => c.handle === 'books'));

  const before = hits;
  const books = await call('/shop?collection=books');
  assert.deepEqual(
    books.data.products.map((p) => p.title),
    ['Savage Memes Vol. 5'],
  );
  await call('/shop?collection=books');
  assert.equal(hits - before, 1, 'second request served from cache');

  const all = await call('/shop?collection=not-a-collection');
  assert.equal(all.data.collection, 'all');
  assert.equal(all.data.products.length, 2);
});

test('art merges the art collections, each piece once, newest first', async () => {
  const r = await call('/art');
  assert.deepEqual(
    r.data.pieces.map((p) => p.title),
    ['Original', 'Print A'],
  );
  assert.equal(r.data.pieces[0].collection, 'Original art');
});

test('when the store is down: last good copy if we have one, otherwise a clear 502', async () => {
  storeUp = false;
  clearShopCache();
  const r = await call('/shop?collection=mugs');
  assert.equal(r.status, 502);
  assert.match(r.data.error, /store isn’t responding/);
  storeUp = true;
});

test('requests that arrive while the store is being asked share that one request', async () => {
  clearShopCache();
  delayMs = 100;
  const before = hits;
  try {
    const results = await Promise.all([1, 2, 3].map(() => call('/shop?collection=books')));
    assert.deepEqual(
      results.map((r) => r.data.products.length),
      [1, 1, 1],
    );
    assert.equal(hits - before, 1);
  } finally {
    delayMs = 0;
  }
});
