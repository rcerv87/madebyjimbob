// Favorite members (MBJ-220): a Premium member highlights people in a color of their choice in every chat and
// comment section, on every device. Favorites are kept if Premium lapses; they just aren't sent to the web app
// (so nothing highlights) until the member is Premium again. Removing one is always allowed.
import { pool } from './db.js';

export const FAVORITE_COLORS = [
  'red',
  'orange',
  'yellow',
  'lime',
  'green',
  'teal',
  'blue',
  'indigo',
  'purple',
  'pink',
];
export const MAX_FAVORITES = 100;

export const canFavorite = (user) => user?.tier === 'premium';

// Throws 'not-found', 'self', or 'full'.
export async function setFavorite(userId, username, color) {
  const { rows } = await pool.query('SELECT id FROM users WHERE username_key = lower($1)', [
    String(username || ''),
  ]);
  const target = rows[0];
  if (!target) throw new Error('not-found');
  if (String(target.id) === String(userId)) throw new Error('self');
  const { rows: added } = await pool.query(
    `INSERT INTO user_favorites (user_id, favorite_id, color)
     SELECT $1, $2, $3 WHERE (SELECT count(*) FROM user_favorites WHERE user_id = $1) < $4
     ON CONFLICT (user_id, favorite_id) DO UPDATE SET color = EXCLUDED.color
     RETURNING 1`,
    [userId, target.id, color, MAX_FAVORITES],
  );
  if (!added.length) throw new Error('full');
}

export async function removeFavorite(userId, username) {
  await pool.query(
    'DELETE FROM user_favorites WHERE user_id = $1 AND favorite_id = (SELECT id FROM users WHERE username_key = lower($2))',
    [userId, String(username || '')],
  );
}

// [{ username, color, since }], by name.
export async function favoritesOf(userId) {
  const { rows } = await pool.query(
    `SELECT u.username, f.color, f.created_at FROM user_favorites f JOIN users u ON u.id = f.favorite_id
     WHERE f.user_id = $1 ORDER BY u.username_key`,
    [userId],
  );
  return rows.map((r) => ({ username: r.username, color: r.color, since: r.created_at }));
}
