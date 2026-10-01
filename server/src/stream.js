// Cloudflare Stream playback URLs. Signed URLs for paid tiers come later:
// enable requireSignedURLs on the video and mint a token here.
export function playback(uid) {
  if (!uid) return null;
  const code = process.env.CF_STREAM_CUSTOMER_CODE;
  const base = code
    ? `https://customer-${code}.cloudflarestream.com/${uid}`
    : `https://videodelivery.net/${uid}`;
  return {
    hls: `${base}/manifest/video.m3u8`,
    thumbnail: `${base}/thumbnails/thumbnail.jpg?time=20s&height=360`,
  };
}

// Deletes a video file from Cloudflare Stream (frees storage). Needs CF_ACCOUNT_ID and CF_API_TOKEN.
// Returns { deleted, reason }.
export async function deleteFromStream(uid) {
  const { CF_ACCOUNT_ID, CF_API_TOKEN } = process.env;
  if (!uid) return { deleted: false, reason: 'no-file' };
  if (!CF_ACCOUNT_ID || !CF_API_TOKEN) return { deleted: false, reason: 'not-configured' };
  const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/stream/${uid}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${CF_API_TOKEN}` },
    signal: AbortSignal.timeout(15_000),
  });
  if (res.ok || res.status === 404) return { deleted: true };
  return { deleted: false, reason: `cloudflare-${res.status}` };
}

const cf = () => {
  const { CF_ACCOUNT_ID, CF_API_TOKEN } = process.env;
  return CF_ACCOUNT_ID && CF_API_TOKEN
    ? { base: `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/stream`, token: CF_API_TOKEN }
    : null;
};
export const streamConfigured = () => Boolean(cf());

// A one-time tus upload URL the browser sends the file to directly (no size limit worth worrying about; the
// file never passes through our server). Returns { uploadUrl, uid }.
export async function createDirectUpload(size, name) {
  const c = cf();
  if (!c) throw new Error('not-configured');
  const res = await fetch(`${c.base}?direct_user=true`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${c.token}`,
      'Tus-Resumable': '1.0.0',
      'Upload-Length': String(size),
      'Upload-Metadata': `name ${Buffer.from(String(name).slice(0, 200)).toString('base64')}`,
    },
    signal: AbortSignal.timeout(15_000),
  });
  const uploadUrl = res.headers.get('location');
  const uid = res.headers.get('stream-media-id');
  if (!res.ok || !uploadUrl || !uid) throw new Error(`cloudflare-${res.status}`);
  return { uploadUrl, uid };
}

// Where Cloudflare is with a file: { ready, state, pct, duration, error }.
export async function streamStatus(uid) {
  const c = cf();
  if (!c) throw new Error('not-configured');
  const res = await fetch(`${c.base}/${uid}`, {
    headers: { Authorization: `Bearer ${c.token}` },
    signal: AbortSignal.timeout(15_000),
  });
  if (res.status === 404) return { ready: false, state: 'missing' };
  const body = await res.json().catch(() => ({}));
  const r = body.result || {};
  return {
    ready: Boolean(r.readyToStream),
    state: r.status?.state || 'unknown',
    pct: r.status?.pctComplete != null ? Number(r.status.pctComplete) : null,
    duration: r.duration > 0 ? r.duration : null,
    error: r.status?.errorReasonText || null,
  };
}
