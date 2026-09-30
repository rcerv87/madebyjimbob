import { test } from 'node:test';
import assert from 'node:assert/strict';
import { videoKind } from '../src/ingest/videoKind.js';

test('past live streams are live, whatever their shape', () => {
  assert.equal(videoKind({ was_live: true, duration: 12_000, width: 1920, height: 1080 }), 'live');
  assert.equal(videoKind({ live_status: 'was_live', duration: 60 }), 'live');
});

test('vertical and 3 minutes or less, or a /shorts/ link, is a short', () => {
  assert.equal(videoKind({ duration: 45, width: 1080, height: 1920 }), 'short');
  assert.equal(videoKind({ duration: 180, width: 720, height: 1280 }), 'short');
  assert.equal(videoKind({ webpage_url: 'https://www.youtube.com/shorts/abc', duration: 30 }), 'short');
});

test('everything else is a regular video', () => {
  assert.equal(videoKind({ duration: 604, width: 360, height: 640 }), 'video', 'vertical but over 3 minutes');
  assert.equal(videoKind({ duration: 60, width: 1920, height: 1080 }), 'video', 'short but horizontal');
  assert.equal(videoKind({}), 'video');
});
