// Talks to S3-compatible storage (Cloudflare R2, Backblaze B2) with AWS Signature V4 and nothing but Node's crypto,
// so the recorder on the live server needs no packages. Also used by the site to close recordings and copy them to the
// archive (MBJ-310).
import crypto from 'crypto';

const hmac = (key, data) => crypto.createHmac('sha256', key).update(data).digest();
const hash = (data) => crypto.createHash('sha256').update(data).digest('hex');

// cfg: { endpoint: 'https://<host>', accessKey, secret, bucket, region? } — region 'auto' for R2, e.g. 'us-east-005'
// for B2 (taken from the endpoint when not given). Returns the fetch Response; throws when it isn't OK.
export async function s3Request(cfg, method, key, { body = '', headers: extra = {}, query = '' } = {}) {
  const url = new URL(
    `${cfg.endpoint}/${cfg.bucket}${key ? `/${key.split('/').map(encodeURIComponent).join('/')}` : ''}${query ? `?${query}` : ''}`,
  );
  const region = cfg.region || url.host.match(/^s3\.([a-z0-9-]+)\.backblazeb2\.com$/)?.[1] || 'auto';
  const amzDate = new Date().toISOString().replace(/[-:]|\.\d{3}/g, '');
  const day = amzDate.slice(0, 8);
  const payloadHash = hash(body);
  const headers = { ...extra, host: url.host, 'x-amz-content-sha256': payloadHash, 'x-amz-date': amzDate };
  const names = Object.keys(headers)
    .map((n) => n.toLowerCase())
    .sort();
  const lower = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
  const canonicalQuery = [...url.searchParams]
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .sort()
    .join('&');
  const canonical = [
    method,
    url.pathname,
    canonicalQuery,
    names.map((n) => `${n}:${String(lower[n]).trim()}\n`).join(''),
    names.join(';'),
    payloadHash,
  ].join('\n');
  const scope = `${day}/${region}/s3/aws4_request`;
  const toSign = ['AWS4-HMAC-SHA256', amzDate, scope, hash(canonical)].join('\n');
  const kSigning = hmac(hmac(hmac(hmac(`AWS4${cfg.secret}`, day), region), 's3'), 'aws4_request');
  const signature = crypto.createHmac('sha256', kSigning).update(toSign).digest('hex');
  const res = await fetch(url, {
    method,
    headers: {
      ...lower,
      authorization: `AWS4-HMAC-SHA256 Credential=${cfg.accessKey}/${scope}, SignedHeaders=${names.join(';')}, Signature=${signature}`,
    },
    body: method === 'GET' || method === 'HEAD' ? undefined : body,
    signal: AbortSignal.timeout(60000),
  });
  if (!res.ok && !(method === 'DELETE' && res.status === 404))
    throw new Error(`${method} ${key}: ${res.status} ${(await res.text()).slice(0, 200)}`);
  return res;
}

// Uploads one object.
export const r2Put = (cfg, key, body, contentType, cacheControl = 'no-cache') =>
  s3Request(cfg, 'PUT', key, {
    body,
    headers: { 'cache-control': cacheControl, 'content-type': contentType },
  });

// Every key under a prefix (ListObjectsV2, following continuation).
export async function s3List(cfg, prefix) {
  const keys = [];
  let token = '';
  for (;;) {
    const query = new URLSearchParams({
      'list-type': '2',
      prefix,
      ...(token && { 'continuation-token': token }),
    });
    const xml = await (await s3Request(cfg, 'GET', '', { query: query.toString() })).text();
    for (const m of xml.matchAll(/<Key>([^<]+)<\/Key>/g)) keys.push(m[1].replace(/&amp;/g, '&'));
    token = xml.match(/<NextContinuationToken>([^<]+)<\/NextContinuationToken>/)?.[1] || '';
    if (!token) return keys;
  }
}

// A time-limited link anyone can GET (query-string SigV4), for playing a private bucket.
export function presignGet(cfg, key, expiresS = 21600) {
  return presign(cfg, 'GET', key, expiresS);
}

// A time-limited link for one request on one key (GET to read, PUT to upload), signed with query-string SigV4.
export function presign(cfg, method, key, expiresS = 21600) {
  const url = new URL(`${cfg.endpoint}/${cfg.bucket}/${key.split('/').map(encodeURIComponent).join('/')}`);
  const region = cfg.region || url.host.match(/^s3\.([a-z0-9-]+)\.backblazeb2\.com$/)?.[1] || 'auto';
  const amzDate = new Date().toISOString().replace(/[-:]|\.\d{3}/g, '');
  const day = amzDate.slice(0, 8);
  const scope = `${day}/${region}/s3/aws4_request`;
  const params = new URLSearchParams({
    'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
    'X-Amz-Credential': `${cfg.accessKey}/${scope}`,
    'X-Amz-Date': amzDate,
    'X-Amz-Expires': String(expiresS),
    'X-Amz-SignedHeaders': 'host',
  });
  const canonicalQuery = [...params]
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .sort()
    .join('&');
  const canonical = [
    method,
    url.pathname,
    canonicalQuery,
    `host:${url.host}\n`,
    'host',
    'UNSIGNED-PAYLOAD',
  ].join('\n');
  const toSign = ['AWS4-HMAC-SHA256', amzDate, scope, hash(canonical)].join('\n');
  const kSigning = hmac(hmac(hmac(hmac(`AWS4${cfg.secret}`, day), region), 's3'), 'aws4_request');
  const signature = crypto.createHmac('sha256', kSigning).update(toSign).digest('hex');
  return `${url.origin}${url.pathname}?${canonicalQuery}&X-Amz-Signature=${signature}`;
}
