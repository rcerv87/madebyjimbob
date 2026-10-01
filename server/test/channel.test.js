import { test, before, after, afterEach, describe } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, stopServer, client, signIn, seedVideo, pool, sleep } from './helpers.js';
import { parseChannel, parseTab, claimNextListing, saveListing, failListing } from '../src/channel.js';

let call;
let admin;
before(async () => {
  const { base } = await startServer();
  call = client(base);
  admin = await signIn(call, 'channel_admin');
  await pool.query(`UPDATE users SET role = 'admin' WHERE username = 'channel_admin'`);
});
after(stopServer);

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
  delete process.env.YOUTUBE_API_KEY;
});

const page = (query = '') => call(`/studio/channel${query}`, { token: admin });
const entry = (id, over = {}) => ({
  youtubeId: id,
  title: `Video ${id}`,
  kind: 'video',
  publishedAt: '2026-09-01T00:00:00Z',
  durationS: 600,
  availability: 'public',
  ...over,
});

describe('reading channel links', () => {
  test('handles, handle links (any tab), and channel ids', () => {
    assert.deepEqual(parseChannel('@MadebyJimbob'), {
      key: '@madebyjimbob',
      url: 'https://www.youtube.com/@MadebyJimbob',
      handle: '@MadebyJimbob',
    });
    assert.equal(parseChannel('https://www.youtube.com/@madebyjimbob/streams').key, '@madebyjimbob');
    assert.equal(
      parseChannel('youtube.com/channel/UCe37IG3iLRcQlteFFBkX6Pw/videos').key,
      'UCe37IG3iLRcQlteFFBkX6Pw',
    );
    assert.equal(parseChannel('https://www.youtube.com/watch?v=abc'), null);
    assert.equal(parseChannel('https://example.com/@x'), null);
  });

  test("yt-dlp's flat tab listing becomes entries; upcoming and live-now streams are left out", () => {
    const json = {
      entries: [
        {
          id: 'AAAAAAAAAAA',
          title: 'Past stream',
          duration: 16876,
          timestamp: 1790812800,
          live_status: 'was_live',
          availability: 'subscriber_only',
        },
        { id: 'BBBBBBBBBBB', title: 'Next week', live_status: 'is_upcoming' },
      ],
    };
    assert.deepEqual(parseTab(json, 'streams'), [
      {
        youtubeId: 'AAAAAAAAAAA',
        title: 'Past stream',
        kind: 'live',
        publishedAt: new Date(1790812800 * 1000).toISOString(),
        durationS: 16876,
        availability: 'subscriber_only',
        position: 0,
      },
    ]);
  });
});

describe('Studio → From the channel (no API key: the helper lists it)', () => {
  test('viewers can’t see it', async () => {
    const viewer = await signIn(call, 'channel_viewer');
    assert.equal((await call('/studio/channel', { token: viewer })).status, 403);
  });

  test('asks the helper for a list, then shows each video as on the site, queued, or new', async () => {
    const empty = await page();
    assert.equal(empty.status, 200);
    assert.equal(empty.data.channel.key, '@madebyjimbob', "JimBob's channel by default");
    assert.equal(empty.data.listing, null);
    assert.equal(empty.data.apiKey, false);

    const asked = await call('/studio/channel/refresh', { method: 'POST', token: admin, body: {} });
    assert.equal(asked.data.listing.status, 'queued');
    assert.equal(asked.data.listing.source, 'helper');
    const again = await call('/studio/channel/refresh', { method: 'POST', token: admin, body: {} });
    assert.equal(again.data.listing.id, asked.data.listing.id, 'one request at a time per channel');
    assert.equal(
      (await call('/studio/channel/refresh', { method: 'POST', token: admin, body: { url: 'nope' } })).status,
      400,
    );

    // The helper does its part.
    const listing = await claimNextListing();
    assert.equal(listing.channel_key, '@madebyjimbob');
    const onSite = await seedVideo();
    await pool.query(`UPDATE videos SET youtube_id = 'ONSITE00001' WHERE id = $1`, [onSite]);
    await call('/studio/imports', { method: 'POST', token: admin, body: { urls: ['QUEUED00001'] } });
    await saveListing(listing.id, [
      entry('ONSITE00001', { publishedAt: '2026-09-03T00:00:00Z' }),
      entry('QUEUED00001', { publishedAt: '2026-09-02T00:00:00Z' }),
      entry('NEWVIDEO001', { kind: 'live', title: 'Debate night', availability: 'subscriber_only' }),
      entry('NEWSHORT001', { kind: 'short', publishedAt: null, durationS: null }),
    ]);

    const all = await page('?show=all');
    assert.equal(all.data.listing.status, 'done');
    assert.equal(all.data.listing.videoCount, 4);
    assert.deepEqual(all.data.counts, { all: 4, onsite: 1, queued: 1, new: 2 });
    assert.deepEqual(
      all.data.videos.map((v) => [v.youtubeId, v.state]),
      [
        ['ONSITE00001', 'onsite'],
        ['QUEUED00001', 'queued'],
        ['NEWVIDEO001', 'new'],
        ['NEWSHORT001', 'new'],
      ],
      'newest first, undated last',
    );
    assert.equal(all.data.videos[0].videoId, onSite);
    assert.equal(all.data.videos[2].availability, 'subscriber_only');

    const fresh = await page();
    assert.deepEqual(
      fresh.data.videos.map((v) => v.youtubeId),
      ['NEWVIDEO001', 'NEWSHORT001'],
      'only what isn’t imported or queued, by default',
    );
    assert.deepEqual(
      (await page('?kind=live')).data.videos.map((v) => v.youtubeId),
      ['NEWVIDEO001'],
    );
    assert.deepEqual(
      (await page('?q=debate')).data.videos.map((v) => v.youtubeId),
      ['NEWVIDEO001'],
    );
    const paged = await page('?show=all&limit=2&offset=2');
    assert.equal(paged.data.total, 4);
    assert.deepEqual(
      paged.data.videos.map((v) => v.youtubeId),
      ['NEWVIDEO001', 'NEWSHORT001'],
    );

    // Queue the picks with the existing import queue; they move to "queued".
    await call('/studio/imports', {
      method: 'POST',
      token: admin,
      body: { urls: ['NEWVIDEO001', 'NEWSHORT001'] },
    });
    assert.deepEqual((await page()).data.videos, []);
    assert.deepEqual((await page('?show=all')).data.counts, { all: 4, onsite: 1, queued: 3, new: 0 });
  });

  test('a listing the helper couldn’t do says why', async () => {
    const asked = await call('/studio/channel/refresh', {
      method: 'POST',
      token: admin,
      body: { url: 'https://www.youtube.com/@someoneelse' },
    });
    const listing = await claimNextListing();
    assert.equal(listing.id, asked.data.listing.id);
    await failListing(listing.id, 'This channel does not exist.');
    const r = await page(`?url=${encodeURIComponent('https://www.youtube.com/@someoneelse')}`);
    assert.deepEqual(
      [r.data.listing.status, r.data.listing.error],
      ['failed', 'This channel does not exist.'],
    );
  });
});

describe('Studio → From the channel (with a YouTube API key)', () => {
  test('lists the uploads right away: lengths, live streams, shorts; skips upcoming', async () => {
    process.env.YOUTUBE_API_KEY = 'test-key';
    const calls = [];
    globalThis.fetch = async (url, opts) => {
      const u = new URL(String(url));
      if (u.hostname !== 'www.googleapis.com') return realFetch(url, opts);
      calls.push(u.pathname);
      const json = (body) => new Response(JSON.stringify(body), { status: 200 });
      if (u.pathname.endsWith('/channels')) {
        assert.equal(u.searchParams.get('forHandle'), '@apichannel');
        return json({ items: [{ contentDetails: { relatedPlaylists: { uploads: 'UUapi' } } }] });
      }
      if (u.pathname.endsWith('/playlistItems')) {
        const second = u.searchParams.get('pageToken') === 'p2';
        const item = (id, title) => ({
          snippet: { title, publishedAt: '2026-08-01T00:00:00Z' },
          contentDetails: { videoId: id, videoPublishedAt: '2026-08-01T00:00:00Z' },
        });
        return json(
          second
            ? { items: [item('APISHORT001', 'A short')] }
            : {
                items: [
                  item('APIVIDEO001', 'A video'),
                  item('APILIVE0001', 'A stream'),
                  item('APISOON0001', 'Soon'),
                ],
                nextPageToken: 'p2',
              },
        );
      }
      if (u.pathname.endsWith('/videos')) {
        const all = {
          APIVIDEO001: { contentDetails: { duration: 'PT1H2M3S' }, status: { privacyStatus: 'public' } },
          APILIVE0001: {
            contentDetails: { duration: 'PT3H' },
            liveStreamingDetails: { actualEndTime: '2026-08-01T05:00:00Z' },
            status: { privacyStatus: 'public' },
          },
          APISOON0001: {
            contentDetails: { duration: 'P0D' },
            liveStreamingDetails: { scheduledStartTime: 'x' },
          },
          APISHORT001: { contentDetails: { duration: 'PT45S' }, status: { privacyStatus: 'public' } },
        };
        const ids = u.searchParams.get('id').split(',');
        return json({ items: ids.filter((id) => all[id]).map((id) => ({ id, ...all[id] })) });
      }
      return new Response('{}', { status: 404 });
    };

    const url = 'https://www.youtube.com/@apichannel';
    const asked = await call('/studio/channel/refresh', { method: 'POST', token: admin, body: { url } });
    assert.equal(asked.data.listing.source, 'api');
    let r;
    for (let i = 0; i < 50; i += 1) {
      r = await page(`?show=all&url=${encodeURIComponent(url)}`);
      if (r.data.listing.status !== 'running') break;
      await sleep(20);
    }
    assert.equal(r.data.listing.status, 'done');
    const got = Object.fromEntries(r.data.videos.map((v) => [v.youtubeId, [v.kind, v.durationS]]));
    assert.deepEqual(got, {
      APIVIDEO001: ['video', 3723],
      APILIVE0001: ['live', 10800],
      APISHORT001: ['short', 45],
    });
    assert.ok(calls.filter((p) => p.endsWith('/playlistItems')).length === 2, 'follows every page');
  });
});
