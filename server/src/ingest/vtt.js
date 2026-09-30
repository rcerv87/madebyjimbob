// WebVTT caption files -> cues and a readable plain-text transcript. Pure functions.

const TIMING = /^(\d{1,2}:)?\d{2}:\d{2}\.\d{3}\s+-->\s+(\d{1,2}:)?\d{2}:\d{2}\.\d{3}/;

function toMs(stamp) {
  const parts = stamp.split(':').map(Number);
  const [h, m, s] = parts.length === 3 ? parts : [0, ...parts];
  return Math.round(((h * 60 + m) * 60 + s) * 1000);
}

const decode = (s) =>
  s
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"');

// Returns [{ startMs, endMs, text }], skipping the header, NOTE/STYLE/REGION blocks, and empty cues.
export function parseVtt(vtt) {
  const blocks = String(vtt)
    .replace(/\r\n?/g, '\n')
    .split(/\n{2,}/);
  const cues = [];
  for (const block of blocks) {
    const lines = block.split('\n').filter((l) => l.trim() !== '');
    const t = lines.findIndex((l) => TIMING.test(l.trim()));
    if (t === -1) continue;
    const [start, end] = lines[t].trim().split(/\s+-->\s+/);
    const text = decode(lines.slice(t + 1).join(' '))
      .replace(/\s+/g, ' ')
      .trim();
    if (text) cues.push({ startMs: toMs(start), endMs: toMs(end.split(/\s/)[0]), text });
  }
  return cues;
}

// Plain transcript: cue text joined with spaces, repeated consecutive cues dropped (auto captions
// often repeat a line as it scrolls), and a paragraph break wherever speech pauses for 4+ seconds.
export function vttToText(vtt, { pauseMs = 4000 } = {}) {
  const cues = parseVtt(vtt);
  const paragraphs = [];
  let current = [];
  let lastEnd = null;
  let lastText = null;
  for (const cue of cues) {
    if (cue.text === lastText) continue;
    if (lastEnd !== null && cue.startMs - lastEnd >= pauseMs && current.length) {
      paragraphs.push(current.join(' '));
      current = [];
    }
    current.push(cue.text);
    lastEnd = cue.endMs;
    lastText = cue.text;
  }
  if (current.length) paragraphs.push(current.join(' '));
  return { text: paragraphs.join('\n\n'), cueCount: cues.length };
}
