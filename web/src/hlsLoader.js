// hls.js (~580 KB) loads only where it's used. iPhones (the website and the app) and Safari play HLS themselves, so
// they never download it; elsewhere it starts loading as soon as a player gets its video, not on the Play tap.

// The same test as hls.js's isSupported(), without loading it: Media Source Extensions that can play H.264 and AAC.
export function mseSupported() {
  if (typeof self === 'undefined') return false;
  const ms = self.ManagedMediaSource || self.MediaSource || self.WebKitMediaSource;
  if (!ms || typeof ms.isTypeSupported !== 'function') return false;
  const sb = self.SourceBuffer || self.WebKitSourceBuffer;
  if (sb && (typeof sb.prototype?.appendBuffer !== 'function' || typeof sb.prototype?.remove !== 'function'))
    return false;
  return ['video/mp4; codecs="avc1.42E01E,mp4a.40.2"', 'audio/mp4; codecs="mp4a.40.2"'].some((type) =>
    ms.isTypeSupported(type),
  );
}

let loading = null;
// The hls.js class, loaded once (a failed load is tried again next time).
export function loadHls() {
  loading ||= import('hls.js')
    .then((m) => m.default)
    .catch((err) => {
      loading = null;
      throw err;
    });
  return loading;
}
