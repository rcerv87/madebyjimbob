import { describe, test, expect } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import Shop from '../pages/Shop.jsx';
import Art from '../pages/Art.jsx';
import BrandHero from '../components/BrandHero.jsx';

const product = (id, title, over = {}) => ({
  id: String(id),
  title,
  url: `https://madebyjimbob.com/products/p${id}`,
  price: 40,
  priceVaries: false,
  compareAt: null,
  available: true,
  image: 'https://madebyjimbob.com/cdn/shop/files/x.jpg',
  collection: 'Art prints',
  ...over,
});

describe('Shop', () => {
  test('shows products that open in the store, with prices, sale and sold-out labels', async () => {
    mockApi({
      '/shop/collections': {
        collections: [
          { handle: 'all', label: 'All' },
          { handle: 'books', label: 'Books' },
        ],
      },
      '/shop': {
        products: [
          product(1, 'Savage Memes Vol. 5'),
          product(2, 'Orthodox Sticker Pack', { price: 8, compareAt: 12 }),
          product(3, 'Original piece', { available: false, price: 500 }),
        ],
      },
    });
    render(
      <MemoryRouter>
        <Shop />
      </MemoryRouter>,
    );
    const link = (await screen.findByText('Savage Memes Vol. 5')).closest('a');
    expect(link.getAttribute('href')).toBe('https://madebyjimbob.com/products/p1');
    expect(link.getAttribute('target')).toBe('_blank');
    expect(screen.getByText('$40.00')).toBeTruthy();
    expect(screen.getByText('Sale')).toBeTruthy();
    expect(screen.getByText('Sold out')).toBeTruthy();
    // Store images are requested at a small width to keep the page light.
    expect(document.querySelector('.product-img img').getAttribute('src')).toContain('width=480');

    fireEvent.click(await screen.findByRole('button', { name: 'Books' }));
    await waitFor(() =>
      expect(fetch.mock.calls.some(([u]) => String(u).includes('collection=books'))).toBe(true),
    );
  });
});

describe('Art', () => {
  test('gallery opens a piece large with a link to the store', async () => {
    mockApi({ '/art': { pieces: [product(1, 'Come and See', { collection: 'Original art' })] } });
    render(<Art />);
    fireEvent.click(await screen.findByRole('button', { name: /Come and See/ }));
    const dialog = screen.getByRole('dialog', { name: 'Come and See' });
    expect(dialog.textContent).toContain('Original art');
    expect(screen.getByRole('link', { name: 'View in store ↗' }).getAttribute('href')).toBe(
      'https://madebyjimbob.com/products/p1',
    );
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

describe('BrandHero', () => {
  test('shows the name, schedule, shop and art links, and socials', () => {
    render(
      <MemoryRouter>
        <BrandHero />
      </MemoryRouter>,
    );
    expect(screen.getByRole('heading', { name: 'MADEbyJIMBOB' })).toBeTruthy();
    expect(screen.getByText(/weekdays around 12:00pm ET/)).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Shop' }).getAttribute('href')).toBe('/shop');
    expect(screen.getByRole('link', { name: 'Gab' }).getAttribute('href')).toBe(
      'https://gab.com/MadebyJimbob',
    );
  });
});
