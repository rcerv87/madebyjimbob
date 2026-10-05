// The Library Uploader's own parts (tools/library-uploader, MBJ-818): reading Takeout zips, matching files to
// YouTube videos, and the ffmpeg command and master playlist it makes.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import zlib from 'zlib';
import { listZip, readZipText, extractZipEntry } from '../../tools/library-uploader/zip.mjs';
import {
  takeoutIds,
  matchFile,
  normTitle,
  sizes,
  ffmpegArgs,
  masterPlaylist,
  isMetadataCsv,
  VIDEO,
} from '../../tools/library-uploader/lib.mjs';

// A small zip, stored or deflated, the way Takeout writes them.
function makeZip(files) {
  const parts = [];
  const central = [];
  let offset = 0;
  for (const { name, data, deflate } of files) {
    const body = deflate ? zlib.deflateRawSync(data) : data;
    const nameBuf = Buffer.from(name);
    const crc = zlib.crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(deflate ? 8 : 0, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    parts.push(local, nameBuf, body);
    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE(20, 4);
    cd.writeUInt16LE(20, 6);
    cd.writeUInt16LE(deflate ? 8 : 0, 10);
    cd.writeUInt32LE(crc, 16);
    cd.writeUInt32LE(body.length, 20);
    cd.writeUInt32LE(data.length, 24);
    cd.writeUInt16LE(nameBuf.length, 28);
    cd.writeUInt32LE(offset, 42);
    central.push(cd, nameBuf);
    offset += 30 + nameBuf.length + body.length;
  }
  const cdBuf = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(cdBuf.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, cdBuf, end]);
}

const CSV =
  '﻿Video ID,Approx Duration (ms),Video Title (Original),Privacy\n' +
  'AAAAAAAAAAA,3600000,"Debate: Is God Real? (Part 1)",Public\n' +
  'BBBBBBBBBBB,600000,Guitar build day 3,Unlisted\n';

describe('Takeout zips', () => {
  test('lists entries, reads the metadata CSV, and copies a video out (stored and deflated)', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'takeout-'));
    const video = Buffer.alloc(200000, 7);
    const zip = path.join(dir, 'takeout-20261005-001.zip');
    fs.writeFileSync(
      zip,
      makeZip([
        {
          name: 'Takeout/YouTube and YouTube Music/video metadata/videos.csv',
          data: Buffer.from(CSV),
          deflate: true,
        },
        { name: 'Takeout/YouTube and YouTube Music/videos/Debate_ Is God Real_ (Part 1).mp4', data: video },
        {
          name: 'Takeout/YouTube and YouTube Music/videos/Guitar build day 3.mp4',
          data: video,
          deflate: true,
        },
      ]),
    );
    const entries = await listZip(zip);
    assert.deepEqual(
      entries.map((e) => [e.name.split('/').pop(), e.size]),
      [
        ['videos.csv', Buffer.byteLength(CSV)],
        ['Debate_ Is God Real_ (Part 1).mp4', 200000],
        ['Guitar build day 3.mp4', 200000],
      ],
    );
    assert.ok(isMetadataCsv(entries[0].name));
    assert.ok(VIDEO.test(entries[1].name));
    const ids = takeoutIds(await readZipText(zip, entries[0]));
    assert.equal(ids.get(normTitle('Guitar build day 3')).youtubeId, 'BBBBBBBBBBB');
    for (const e of entries.slice(1)) {
      const out = path.join(dir, 'out.mp4');
      let seen = 0;
      await extractZipEntry(zip, e, out, (n) => (seen += n));
      assert.ok(fs.readFileSync(out).equals(video));
      assert.equal(seen, 200000);
    }
    await assert.rejects(listZip(path.join(dir, 'missing.zip')));
    fs.writeFileSync(path.join(dir, 'half.zip'), Buffer.alloc(100));
    await assert.rejects(listZip(path.join(dir, 'half.zip')), /not a zip file/);
  });
});

describe('matching files to YouTube videos', () => {
  const csv = takeoutIds(CSV);
  const byTitle = new Map([
    [normTitle('Only on the channel'), [{ youtubeId: 'CCCCCCCCCCC', title: 'Only on the channel' }]],
  ]);
  test('by Takeout’s CSV (its punctuation-mangled file names too), an [id] in the name, or a unique channel title', () => {
    assert.equal(
      matchFile('x/Debate_ Is God Real_ (Part 1).mp4', { csv, byTitle }).youtubeId,
      'AAAAAAAAAAA',
      'Takeout turns ? and : into _; matching ignores punctuation',
    );
    assert.equal(matchFile('Guitar build day 3.mp4', { csv, byTitle }).youtubeId, 'BBBBBBBBBBB');
    assert.equal(matchFile('Guitar build day 3 (1).mp4', { csv, byTitle }).youtubeId, 'BBBBBBBBBBB');
    assert.equal(matchFile('obs/stream [DDDDDDDDDDD].mkv', { csv, byTitle }).youtubeId, 'DDDDDDDDDDD');
    assert.equal(matchFile('Only on the channel.mp4', { csv, byTitle }).youtubeId, 'CCCCCCCCCCC');
    assert.equal(matchFile('2026-10-03 21-14-55.mkv', { csv, byTitle }), null);
  });
});

describe('converting', () => {
  test('720p and 360p never upscale and keep the shape; an odd size rounds to even', () => {
    assert.deepEqual(sizes(1920, 1080), {
      hd: { width: 1280, height: 720 },
      sd: { width: 640, height: 360 },
    });
    assert.deepEqual(sizes(640, 360).hd, { width: 640, height: 360 });
    assert.deepEqual(sizes(1080, 1920).hd, { width: 406, height: 720 });
  });

  test('one ffmpeg run makes 720p, 360p and audio as 6-second HLS pieces; NVIDIA or processor', () => {
    const a = ffmpegArgs({
      input: 'in.mp4',
      out: 'o',
      encoder: 'x264',
      hasAudio: true,
      width: 1920,
      height: 1080,
    });
    assert.ok(a.includes('libx264') && !a.includes('h264_nvenc'));
    for (const q of ['720p', '360p', 'audio']) assert.ok(a.includes(`o/${q}/index.m3u8`), q);
    assert.equal(a.filter((x) => x === '6').length, 3);
    assert.ok(a.includes('scale=1280:720') && a.includes('scale=640:360'));
    const n = ffmpegArgs({
      input: 'in.mp4',
      out: 'o',
      encoder: 'nvenc',
      hasAudio: false,
      width: 1280,
      height: 720,
    });
    assert.ok(n.includes('h264_nvenc'));
    assert.ok(!n.includes('o/audio/index.m3u8') && !n.includes('0:a:0'), 'no sound, no audio copy');
  });

  test('the master list matches live replays, so Listen only works', () => {
    const m = masterPlaylist({ width: 1920, height: 1080, hasAudio: true });
    assert.match(m, /GROUP-ID="listen".*URI="audio\/index\.m3u8"/);
    assert.match(m, /RESOLUTION=1280x720[^\n]*\n720p\/index\.m3u8/);
    assert.match(m, /RESOLUTION=640x360[^\n]*\n360p\/index\.m3u8/);
    assert.doesNotMatch(masterPlaylist({ width: 1280, height: 720, hasAudio: false }), /listen/);
  });
});
