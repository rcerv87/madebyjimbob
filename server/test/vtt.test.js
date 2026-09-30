import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseVtt, vttToText } from '../src/ingest/vtt.js';

const sample = [
  'WEBVTT',
  'Kind: captions',
  '',
  'NOTE generated automatically',
  '',
  '1',
  '00:00:01.000 --> 00:00:02.500 align:start position:0%',
  'Welcome back to the <c>stream</c>',
  '',
  '2',
  '00:00:02.500 --> 00:00:04.000',
  'Welcome back to the stream',
  '',
  '00:00:04.000 --> 00:00:06.000',
  'tonight we&apos;re talking',
  'evolution &amp; science',
  '',
  '4',
  '01:02:10.000 --> 01:02:12.250',
  'after the break',
  '',
  '5',
  '01:02:13.000 --> 01:02:14.000',
  '   ',
].join('\r\n');

test('parses cues with hour and minute timestamps, tags, entities, and multi-line text', () => {
  const cues = parseVtt(sample);
  assert.equal(cues.length, 4);
  assert.deepEqual(cues[0], { startMs: 1000, endMs: 2500, text: 'Welcome back to the stream' });
  assert.equal(cues[2].text, "tonight we're talking evolution & science");
  assert.equal(cues[3].startMs, (3600 + 2 * 60 + 10) * 1000);
});

test('builds a transcript without rolling duplicates, with paragraph breaks at long pauses', () => {
  const { text, cueCount } = vttToText(sample);
  assert.equal(cueCount, 4);
  assert.equal(
    text,
    "Welcome back to the stream tonight we're talking evolution & science\n\nafter the break",
  );
});

test('handles empty and header-only files', () => {
  assert.deepEqual(parseVtt(''), []);
  assert.deepEqual(vttToText('WEBVTT\n\n'), { text: '', cueCount: 0 });
});
