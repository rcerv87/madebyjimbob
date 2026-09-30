import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findTimestamps, firstTimestampMs } from '../src/ingest/timestamps.js';

test('finds h:mm:ss and m:ss timestamps in order', () => {
  assert.deepEqual(findTimestamps('0:45 then 12:05 then 1:02:03'), [45_000, 725_000, 3_723_000]);
});

test('ignores ratios, long colon runs, invalid seconds, and times past the end', () => {
  assert.deepEqual(findTimestamps('3:1, 10:30:45:12, 5:75, 99:99'), []);
  assert.equal(firstTimestampMs('2:00:00', 60_000), null);
  assert.equal(firstTimestampMs('nothing'), null);
});
