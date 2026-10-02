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
