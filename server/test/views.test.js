import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, stopServer, client, signIn, seedVideo, pool } from './helpers.js';
import { forgetOldViews } from '../src/views.js';

let call;
before(async () => {
  const { base } = await startServer();
  call = client(base);
});
after(stopServer);

const views = async (id) => (await pool.query('SELECT views FROM videos WHERE id = $1', [id])).rows[0].views;
const view = (id, { token, viewer } = {}) =>
  call(`/videos/${id}/view`, { method: 'POST', token, body: viewer ? { viewer } : {} });

describe('one view per viewer per day', () => {
  test('refreshes and second tabs don’t add views; other viewers do', async () => {
    const id = await seedVideo();
    const token = await signIn(call, 'view_counter');
    assert.equal((await view(id, { token })).data.counted, true);
    assert.equal((await view(id, { token })).data.counted, false);
    assert.equal(
      (await view(id, { token, viewer: 'another-browser-0001' })).data.counted,
      false,
      'the account wins',
    );
    assert.equal(await views(id), 1);

    await view(id, { viewer: 'browser-aaaa-0000-1111' });
    await view(id, { viewer: 'browser-aaaa-0000-1111' });
    await view(id, { viewer: 'browser-bbbb-0000-2222' });
    assert.equal(await views(id), 3);
  });

  test('without a browser id, the same connection counts once', async () => {
    const id = await seedVideo();
    await view(id);
    await view(id, { viewer: 'not valid!' });
    assert.equal(await views(id), 1);
  });

  test('a new day counts again; old days are forgotten', async () => {
    const id = await seedVideo();
    await view(id, { viewer: 'browser-day1-0000-3333' });
    await pool.query(`UPDATE video_views SET day = day - 2 WHERE video_id = $1`, [id]);
    assert.equal((await view(id, { viewer: 'browser-day1-0000-3333' })).data.counted, true);
    assert.equal(await views(id), 2);
    assert.ok((await forgetOldViews()) >= 1);
    const { rows } = await pool.query('SELECT count(*)::int AS n FROM video_views WHERE video_id = $1', [id]);
    assert.equal(rows[0].n, 1, "today's row stays");
  });

  test('unknown videos are 404 and count nothing', async () => {
    assert.equal((await view(999999, { viewer: 'browser-none-0000-4444' })).status, 404);
  });
});
