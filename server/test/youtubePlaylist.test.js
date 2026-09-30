import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePlaylist, channelPlaylistIds } from '../src/ingest/youtubePlaylist.js';

test('a playlist keeps its order and drops duplicates and non-video entries', () => {
  const p = parsePlaylist({
    id: 'PLabc123',
    title: ' Evolution debates ',
    description: 'All of them',
    entries: [{ id: 'vid1' }, { id: 'vid2' }, { id: 'vid1' }, null, { id: 'PLnested' }, { title: 'no id' }],
  });
  assert.deepEqual(p, {
    youtubeId: 'PLabc123',
    title: 'Evolution debates',
    description: 'All of them',
    videoIds: ['vid1', 'vid2'],
  });
});

test('missing fields get sensible defaults', () => {
  assert.deepEqual(parsePlaylist({}), {
    youtubeId: '',
    title: 'Untitled playlist',
    description: '',
    videoIds: [],
  });
});

test("a channel's Playlists tab lists playlist ids from ids or urls", () => {
  assert.deepEqual(
    channelPlaylistIds({
      entries: [
        { id: 'PLone' },
        { id: 'weird', url: 'https://www.youtube.com/playlist?list=PLtwo' },
        { id: 'PLone' },
        { id: 'vid9' },
      ],
    }),
    ['PLone', 'PLtwo'],
  );
});
