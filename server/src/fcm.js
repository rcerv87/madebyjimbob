// Native push for the phone apps (MBJ-405) through Firebase Cloud Messaging's HTTP v1 API, without an SDK.
// FCM_SERVICE_ACCOUNT holds the Firebase service account key: the JSON file as downloaded, or that JSON in base64.
// An access token is made by signing a short JWT with the key's private key and reused until shortly before it
// expires. FCM_API_BASE is only for tests.
import crypto from 'crypto';
import { logger } from './logger.js';

let parsed = { raw: undefined, account: null };
function serviceAccount() {
  const raw = (process.env.FCM_SERVICE_ACCOUNT || '').trim();
  if (raw === parsed.raw) return parsed.account;
  let account = null;
  if (raw) {
    try {
      account = JSON.parse(raw.startsWith('{') ? raw : Buffer.from(raw, 'base64').toString('utf8'));
      if (!account.project_id || !account.client_email || !account.private_key) account = null;
    } catch {
      account = null;
    }
    if (!account) logger.warn('FCM_SERVICE_ACCOUNT is set but isn’t a Firebase service account key');
  }
  parsed = { raw, account };
  return account;
}
export const fcmEnabled = () => Boolean(serviceAccount());

const b64url = (data) => Buffer.from(data).toString('base64url');
let cached = { email: null, token: null, expiresAt: 0 };

async function accessToken(account) {
  if (cached.email === account.client_email && Date.now() < cached.expiresAt - 60_000) return cached.token;
  const now = Math.floor(Date.now() / 1000);
  const tokenUri = account.token_uri || 'https://oauth2.googleapis.com/token';
  const unsigned = `${b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))}.${b64url(
    JSON.stringify({
      iss: account.client_email,
      scope: 'https://www.googleapis.com/auth/firebase.messaging',
      aud: tokenUri,
      iat: now,
      exp: now + 3600,
    }),
  )}`;
  const signature = crypto.createSign('RSA-SHA256').update(unsigned).sign(account.private_key, 'base64url');
  const res = await fetch(tokenUri, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: `${unsigned}.${signature}`,
    }),
    signal: AbortSignal.timeout(10_000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token) throw new Error(`Google refused the Firebase key (${res.status})`);
  cached = {
    email: account.client_email,
    token: data.access_token,
    expiresAt: Date.now() + (data.expires_in || 3600) * 1000,
  };
  return cached.token;
}

// Sends one notification to one app install. Returns 'sent', or 'gone' when Firebase says the token is no longer
// valid (the app was uninstalled or the token replaced), so the caller can forget it. Throws on other failures.
export async function sendFcm(token, { title, body, url, tag }) {
  const account = serviceAccount();
  if (!account) return 'off';
  const base = (process.env.FCM_API_BASE || 'https://fcm.googleapis.com').replace(/\/+$/, '');
  const res = await fetch(`${base}/v1/projects/${encodeURIComponent(account.project_id)}/messages:send`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await accessToken(account)}` },
    body: JSON.stringify({
      message: {
        token,
        notification: { title, body },
        data: { url: url || '/' },
        android: {
          priority: 'HIGH',
          notification: { channel_id: 'activity', ...(tag && { tag }) },
        },
        apns: { payload: { aps: { sound: 'default', ...(tag && { 'thread-id': tag }) } } },
      },
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (res.ok) return 'sent';
  const data = await res.json().catch(() => ({}));
  const code = data.error?.details?.find((d) => d.errorCode)?.errorCode || data.error?.status;
  // Gone: uninstalled or replaced (UNREGISTERED), a token from another Firebase project (SENDER_ID_MISMATCH, after a
  // move to a new project), or not a token at all. Any other bad request is our message's fault: keep the token.
  if (
    res.status === 404 ||
    code === 'UNREGISTERED' ||
    code === 'SENDER_ID_MISMATCH' ||
    (code === 'INVALID_ARGUMENT' && /registration token/i.test(data.error?.message || ''))
  )
    return 'gone';
  throw new Error(`Firebase answered ${res.status} ${code || ''}`.trim());
}

export const forgetCachedFcmToken = () => {
  cached = { email: null, token: null, expiresAt: 0 };
};
