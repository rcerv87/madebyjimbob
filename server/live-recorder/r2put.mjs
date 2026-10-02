// Uploads one object to Cloudflare R2 (S3 API, AWS Signature V4) with nothing but Node's crypto, so the recorder on
// the live server needs no packages. Also used by the site to close a recording (MBJ-310).
import crypto from 'crypto';

const hmac = (key, data) => crypto.createHmac('sha256', key).update(data).digest();
const hash = (data) => crypto.createHash('sha256').update(data).digest('hex');

// cfg: { endpoint: 'https://<account>.r2.cloudflarestorage.com', accessKey, secret, bucket }
export async function r2Put(cfg, key, body, contentType, cacheControl = 'no-cache') {
  const url = new URL(`${cfg.endpoint}/${cfg.bucket}/${key.split('/').map(encodeURIComponent).join('/')}`);
  const now = new Date();
  const amzDate = now.toISOString().replace(/[-:]|\.\d{3}/g, '');
  const day = amzDate.slice(0, 8);
  const payloadHash = hash(body);
  const headers = {
    'cache-control': cacheControl,
    'content-type': contentType,
    host: url.host,
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': amzDate,
  };
  const names = Object.keys(headers).sort();
  const canonical = [
    'PUT',
    url.pathname,
    '',
    names.map((n) => `${n}:${headers[n]}\n`).join(''),
    names.join(';'),
    payloadHash,
  ].join('\n');
  const scope = `${day}/auto/s3/aws4_request`;
  const toSign = ['AWS4-HMAC-SHA256', amzDate, scope, hash(canonical)].join('\n');
  const kSigning = hmac(hmac(hmac(hmac(`AWS4${cfg.secret}`, day), 'auto'), 's3'), 'aws4_request');
  const signature = crypto.createHmac('sha256', kSigning).update(toSign).digest('hex');
  const res = await fetch(url, {
    method: 'PUT',
    headers: {
      ...headers,
      authorization: `AWS4-HMAC-SHA256 Credential=${cfg.accessKey}/${scope}, SignedHeaders=${names.join(';')}, Signature=${signature}`,
    },
    body,
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) throw new Error(`R2 PUT ${key}: ${res.status} ${(await res.text()).slice(0, 200)}`);
}
