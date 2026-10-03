import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, stopServer, client, signIn, pool } from './helpers.js';

let call;
let fan;
before(async () => {
  const { base } = await startServer();
  call = client(base);
  fan = await signIn(call, 'fav_fan');
  await signIn(call, 'fav_friend');
  await signIn(call, 'fav_other');
});
after(stopServer);

const fav = (name, color) =>
  call(`/account/favorites/${name}`, { method: 'PUT', token: fan, body: { color } });
const setTier = (tier) => pool.query('UPDATE users SET tier = $1 WHERE username = $2', [tier, 'fav_fan']);
const me = async () => (await call('/me', { token: fan })).data.user;

describe('favorite members (Premium)', () => {
  test('free and Plus members get an upgrade answer; nothing is saved', async () => {
    for (const tier of ['free', 'plus']) {
      await setTier(tier);
      const r = await fav('fav_friend', 'teal');
      assert.equal(r.status, 403);
      assert.equal(r.data.upgrade, 'premium');
    }
    assert.deepEqual((await call('/account/favorites', { token: fan })).data.favorites, []);
  });

  test('Premium members favorite others in a color, recolor them, and see them on /me', async () => {
    await setTier('premium');
    assert.equal((await fav('fav_friend', 'beige')).status, 400, 'only the palette');
    assert.equal((await fav('fav_fan', 'teal')).status, 400, 'not yourself');
    assert.equal((await fav('nobody_here', 'teal')).status, 404);
    assert.equal((await fav('fav_friend', 'teal')).status, 200);
    const r = await fav('FAV_OTHER', 'pink');
    assert.deepEqual(
      r.data.favorites.map((f) => [f.username, f.color]),
      [
        ['fav_friend', 'teal'],
        ['fav_other', 'pink'],
      ],
    );
    await fav('fav_friend', 'orange');
    assert.deepEqual(
      (await me()).favorites.map((f) => [f.username, f.color]),
      [
        ['fav_friend', 'orange'],
        ['fav_other', 'pink'],
      ],
    );
  });

  test('if Premium lapses, favorites are kept but stop highlighting; removing still works', async () => {
    await setTier('free');
    assert.deepEqual((await me()).favorites, []);
    const list = (await call('/account/favorites', { token: fan })).data;
    assert.equal(list.active, false);
    assert.equal(list.favorites.length, 2);
    const r = await call('/account/favorites/fav_other', { method: 'DELETE', token: fan });
    assert.deepEqual(
      r.data.favorites.map((f) => f.username),
      ['fav_friend'],
    );
    await setTier('premium');
    assert.deepEqual(
      (await me()).favorites.map((f) => f.username),
      ['fav_friend'],
    );
  });

  test('signed out: no favorites', async () => {
    assert.equal((await call('/account/favorites')).status, 401);
  });
});
