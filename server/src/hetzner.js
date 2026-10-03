// A small Hetzner Cloud API client for the live server (ADR-004). Only what Go Live needs: servers and Primary IPs,
// always tagged with the label mbj=live so cleanup never touches anything else in the project.
const API = 'https://api.hetzner.cloud/v1';
export const LIVE_LABEL = 'mbj=live';

export const hetznerConfigured = () => Boolean(process.env.HETZNER_API_TOKEN);

async function call(method, path, body) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { Authorization: `Bearer ${process.env.HETZNER_API_TOKEN}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(20000),
  });
  if (res.status === 204) return {};
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error?.message || `Hetzner answered ${res.status}`);
    err.status = res.status;
    err.code = data.error?.code;
    throw err;
  }
  return data;
}

export const listLiveServers = async () =>
  (await call('GET', `/servers?label_selector=${encodeURIComponent(LIVE_LABEL)}`)).servers;

export const createServer = (spec) =>
  call('POST', '/servers', { ...spec, labels: { mbj: 'live' } }).then((d) => d.server);

export const getServer = (id) => call('GET', `/servers/${id}`).then((d) => d.server);

export async function deleteServer(id) {
  try {
    await call('DELETE', `/servers/${id}`);
  } catch (err) {
    if (err.status !== 404) throw err; // already gone
  }
}

export const findLivePrimaryIp = async () =>
  (await call('GET', `/primary_ips?label_selector=${encodeURIComponent(LIVE_LABEL)}`)).primary_ips[0] || null;

// v2: images whose containers don't restart at boot. Older images (v1) started the previous Owncast and recorder for
// a few seconds on every boot, and OBS could connect to that old Owncast.
export const IMAGE_LABEL = 'mbj=live-image-v2';
const OLD_IMAGE_LABEL = 'mbj=live-image';

// The saved server image Go Live starts from, if one exists (newest first).
export async function findLiveImage() {
  const { images } = await call(
    'GET',
    `/images?type=snapshot&label_selector=${encodeURIComponent(IMAGE_LABEL)}`,
  );
  return images.sort((a, b) => new Date(b.created) - new Date(a.created))[0] || null;
}

// Starts saving a snapshot of a server; returns the action to wait on.
export const snapshotServer = (id) =>
  call('POST', `/servers/${id}/actions/create_image`, {
    type: 'snapshot',
    description: 'MADEbyJIMBOB live server (Docker + Owncast)',
    labels: { mbj: 'live-image-v2' },
  }).then((d) => d.action);

// Deletes saved images from before v2 (they cost a little each month and must never be used).
export async function deleteOldImages() {
  const { images } = await call(
    'GET',
    `/images?type=snapshot&label_selector=${encodeURIComponent(OLD_IMAGE_LABEL)}`,
  );
  for (const image of images) await call('DELETE', `/images/${image.id}`);
  return images.length;
}

export const getAction = (id) => call('GET', `/actions/${id}`).then((d) => d.action);

export const getPrimaryIp = (id) => call('GET', `/primary_ips/${id}`).then((d) => d.primary_ip);

export const createPrimaryIp = (location) =>
  call('POST', '/primary_ips', {
    name: 'madebyjimbob-live',
    type: 'ipv4',
    assignee_type: 'server',
    location,
    auto_delete: false,
    labels: { mbj: 'live' },
  }).then((d) => d.primary_ip);
