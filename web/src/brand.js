// JimBob's brand and where to find him, in one place. Sourced from madebyjimbob.com
// ("Where to find JimBob"); change here when links change.
export const BRAND = {
  name: 'MADEbyJIMBOB',
  avatar: '/brand/avatar.jpg',
  headerArt: '/brand/header-art.jpg',
  store: 'https://madebyjimbob.com',
  schedule: 'Live on YouTube weekdays around 12:00pm ET',
};

export const SOCIALS = [
  { key: 'youtube', label: 'YouTube', url: 'https://www.youtube.com/@madebyjimbob' },
  { key: 'x', label: 'X', url: 'https://x.com/byjimbob' },
  { key: 'instagram', label: 'Instagram', url: 'https://www.instagram.com/madebyjimbob/' },
  { key: 'facebook', label: 'Facebook', url: 'https://www.facebook.com/madebyjimbob/' },
  { key: 'gab', label: 'Gab', url: 'https://gab.com/MadebyJimbob' },
  { key: 'telegram', label: 'Telegram', url: 'https://t.me/MadeByJimBob' },
  { key: 'spotify', label: 'Spotify', url: 'https://open.spotify.com/artist/00Q9iEwZxAIiqbpRFylsR8' },
  { key: 'bandcamp', label: 'Bandcamp', url: 'https://madebyjimbob.bandcamp.com' },
];

// Shopify serves any product image at a requested width (keeps pages light).
export const sized = (src, width) => {
  if (!src) return src;
  const u = new URL(src, 'https://madebyjimbob.com');
  u.searchParams.set('width', String(width));
  return u.href;
};

const USD = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
export const money = (n) => (n === null || n === undefined ? '' : USD.format(n));
