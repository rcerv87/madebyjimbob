// Cloudflare Stream playback URLs. Signed URLs for paid tiers come later:
// enable requireSignedURLs on the video and mint a token here.
export function playback(uid) {
  if (!uid) return null;
  const code = process.env.CF_STREAM_CUSTOMER_CODE;
  const base = code ? `https://customer-${code}.cloudflarestream.com/${uid}` : `https://videodelivery.net/${uid}`;
  return {
    hls: `${base}/manifest/video.m3u8`,
    thumbnail: `${base}/thumbnails/thumbnail.jpg?time=20s&height=360`,
  };
}
