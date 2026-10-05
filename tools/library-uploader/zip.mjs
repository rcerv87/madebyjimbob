// Reads Google Takeout's .zip files in place (no unzipping): the list of entries, a small entry as text, and a big one
// copied to a file. Handles zip64 (Takeout's 50 GB parts) and the two methods Takeout uses: stored and deflate.
import fs from 'fs';
import zlib from 'zlib';
import { pipeline } from 'stream/promises';

const u16 = (b, o) => b.readUInt16LE(o);
const u32 = (b, o) => b.readUInt32LE(o);
const u64 = (b, o) => Number(b.readBigUInt64LE(o));

async function readAt(fd, position, length) {
  const buf = Buffer.alloc(length);
  const { bytesRead } = await fd.read(buf, 0, length, position);
  return buf.subarray(0, bytesRead);
}

// [{ name, size, compressedSize, method, offset }] for every file in the zip.
export async function listZip(file) {
  const fd = await fs.promises.open(file, 'r');
  try {
    const { size } = await fd.stat();
    const tailLen = Math.min(size, 65557 + 20);
    const tail = await readAt(fd, size - tailLen, tailLen);
    let eocd = -1;
    for (let i = tail.length - 22; i >= 0; i -= 1)
      if (u32(tail, i) === 0x06054b50) {
        eocd = i;
        break;
      }
    if (eocd < 0) throw new Error('not a zip file (or an incomplete download)');
    let count = u16(tail, eocd + 10);
    let cdSize = u32(tail, eocd + 12);
    let cdOffset = u32(tail, eocd + 16);
    if (count === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) {
      const loc = eocd - 20;
      if (loc < 0 || u32(tail, loc) !== 0x07064b50) throw new Error('zip64 locator missing');
      const recOffset = u64(tail, loc + 8);
      const rec = await readAt(fd, recOffset, 56);
      if (u32(rec, 0) !== 0x06064b50) throw new Error('zip64 record missing');
      count = u64(rec, 32);
      cdSize = u64(rec, 40);
      cdOffset = u64(rec, 48);
    }
    const cd = await readAt(fd, cdOffset, cdSize);
    const entries = [];
    let p = 0;
    for (let n = 0; n < count && p + 46 <= cd.length; n += 1) {
      if (u32(cd, p) !== 0x02014b50) throw new Error('damaged zip directory');
      const method = u16(cd, p + 10);
      let compressedSize = u32(cd, p + 20);
      let uncompressed = u32(cd, p + 24);
      const nameLen = u16(cd, p + 28);
      const extraLen = u16(cd, p + 30);
      const commentLen = u16(cd, p + 32);
      let offset = u32(cd, p + 42);
      const name = cd.toString('utf8', p + 46, p + 46 + nameLen);
      // zip64 sizes and offset live in extra field 0x0001, in this order, only for the fields that overflowed.
      let e = p + 46 + nameLen;
      const end = e + extraLen;
      while (e + 4 <= end) {
        const id = u16(cd, e);
        const len = u16(cd, e + 2);
        if (id === 0x0001) {
          let q = e + 4;
          if (uncompressed === 0xffffffff) ((uncompressed = u64(cd, q)), (q += 8));
          if (compressedSize === 0xffffffff) ((compressedSize = u64(cd, q)), (q += 8));
          if (offset === 0xffffffff) offset = u64(cd, q);
        }
        e += 4 + len;
      }
      if (!name.endsWith('/')) entries.push({ name, size: uncompressed, compressedSize, method, offset });
      p += 46 + nameLen + extraLen + commentLen;
    }
    return entries;
  } finally {
    await fd.close();
  }
}

async function dataStart(file, entry) {
  const fd = await fs.promises.open(file, 'r');
  try {
    const head = await readAt(fd, entry.offset, 30);
    if (u32(head, 0) !== 0x04034b50) throw new Error(`damaged zip entry: ${entry.name}`);
    return entry.offset + 30 + u16(head, 26) + u16(head, 28);
  } finally {
    await fd.close();
  }
}

function entryStream(file, entry, start) {
  if (![0, 8].includes(entry.method))
    throw new Error(`unsupported zip method ${entry.method}: ${entry.name}`);
  const raw = fs.createReadStream(file, {
    start,
    end: start + entry.compressedSize - 1,
    highWaterMark: 4 << 20,
  });
  return entry.method === 8 ? raw.pipe(zlib.createInflateRaw()) : raw;
}

// A small entry (a CSV) as text.
export async function readZipText(file, entry) {
  const chunks = [];
  for await (const c of entryStream(file, entry, await dataStart(file, entry))) chunks.push(c);
  return Buffer.concat(chunks).toString('utf8');
}

// Copies an entry to dest (a video, for ffmpeg, which needs a real file to seek in). onBytes(n) reports progress.
export async function extractZipEntry(file, entry, dest, onBytes) {
  const src = entryStream(file, entry, await dataStart(file, entry));
  if (onBytes) src.on('data', (c) => onBytes(c.length));
  await pipeline(src, fs.createWriteStream(dest, { highWaterMark: 4 << 20 }));
}
