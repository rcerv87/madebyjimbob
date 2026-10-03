import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { edgePlaylist, pieceKey } from '../live-recorder/edge.mjs';

const owncast = [
  '#EXTM3U',
  '#EXT-X-VERSION:6',
  '#EXT-X-TARGETDURATION:1',
  '#EXT-X-MEDIA-SEQUENCE:61',
  '#EXTINF:1.000000,',
  '#EXT-X-PROGRAM-DATE-TIME:2026-10-03T06:08:23.368+0000',
  'stream-a-61.ts',
  '#EXTINF:1.000000,',
  '#EXT-X-PROGRAM-DATE-TIME:2026-10-03T06:08:24.368+0000',
  'stream-a-62.ts',
  '#EXTINF:1.000000,',
  '#EXT-X-PROGRAM-DATE-TIME:2026-10-03T06:08:25.368+0000',
  'stream-a-63.ts',
  '',
].join('\n');

describe('live viewers’ playlists (MBJ-311)', () => {
  test('lists only uploaded pieces, pointing back at Owncast’s files', async () => {
    const inBucket = new Set(['hls/2/stream-a-61.ts', 'hls/2/stream-a-62.ts']);
    const asked = [];
    const out = await edgePlaylist(owncast, 2, {
      up: '../../',
      isUploaded: async (key) => {
        asked.push(key);
        return inBucket.has(key);
      },
    });
    assert.equal(
      out,
      [
        '#EXTM3U',
        '#EXT-X-VERSION:6',
        '#EXT-X-TARGETDURATION:1',
        '#EXT-X-MEDIA-SEQUENCE:61',
        '#EXTINF:1.000000,',
        '#EXT-X-PROGRAM-DATE-TIME:2026-10-03T06:08:23.368+0000',
        '../../hls/2/stream-a-61.ts',
        '#EXTINF:1.000000,',
        '#EXT-X-PROGRAM-DATE-TIME:2026-10-03T06:08:24.368+0000',
        '../../hls/2/stream-a-62.ts',
        '',
      ].join('\n'),
    );
    // Newest first, stopping at the first one that's there.
    assert.deepEqual(asked, ['hls/2/stream-a-63.ts', 'hls/2/stream-a-62.ts']);
  });

  test('keeps the end marker once everything is uploaded; nothing uploaded yet means no playlist', async () => {
    const ended = `${owncast}#EXT-X-ENDLIST\n`;
    const all = await edgePlaylist(ended, 0, { up: '../../', isUploaded: async () => true });
    assert.match(all, /stream-a-63\.ts\n#EXT-X-ENDLIST\n$/);
    assert.equal(await edgePlaylist(owncast, 0, { up: '../../', isUploaded: async () => false }), null);
  });

  test('absolute piece addresses stay as they are and map to their bucket keys', async () => {
    const abs = owncast.replace(/^stream/gm, 'https://live.madebyjimbob.app/hls/1/stream');
    const out = await edgePlaylist(abs, 1, { up: '../../', isUploaded: async () => true });
    assert.match(out, /^https:\/\/live\.madebyjimbob\.app\/hls\/1\/stream-a-63\.ts$/m);
    assert.equal(pieceKey(1, 'https://live.madebyjimbob.app/hls/1/x.ts'), 'hls/1/x.ts');
    assert.equal(pieceKey(1, 'x.ts'), 'hls/1/x.ts');
  });
});
