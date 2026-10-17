// Links that open the phone apps (MBJ-408): the files Android and the iPhone check before they let the app open
// the site's pages.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, stopServer } from './helpers.js';

let site;
before(async () => {
  const { base } = await startServer();
  site = base.replace(/\/api$/, '');
});
after(stopServer);

test('Android: assetlinks.json names the app and its signing keys', async () => {
  const res = await fetch(`${site}/.well-known/assetlinks.json`, { redirect: 'manual' });
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /application\/json/);
  const [entry] = await res.json();
  assert.deepEqual(entry.relation, ['delegate_permission/common.handle_all_urls']);
  assert.equal(entry.target.package_name, 'com.madebyjimbob.app');
  assert.deepEqual(entry.target.sha256_cert_fingerprints, [
    '90:0D:10:83:10:C7:D6:B1:2D:03:9D:12:8D:77:2A:78:96:13:AD:D7:80:F8:1B:01:42:4E:38:B2:51:8D:36:B6',
  ]);

  process.env.ANDROID_CERT_SHA256 = 'aa:bb, CC:DD ';
  try {
    const [again] = await (await fetch(`${site}/.well-known/assetlinks.json`)).json();
    assert.deepEqual(again.target.sha256_cert_fingerprints, ['AA:BB', 'CC:DD']);
  } finally {
    delete process.env.ANDROID_CERT_SHA256;
  }
});

test('iPhone: apple-app-site-association only once the Apple team id is set', async () => {
  assert.equal((await fetch(`${site}/.well-known/apple-app-site-association`)).status, 404);
  process.env.APPLE_TEAM_ID = 'ABCDE12345';
  try {
    const res = await fetch(`${site}/.well-known/apple-app-site-association`);
    assert.equal(res.status, 200);
    const body = await res.json();
    const [detail] = body.applinks.details;
    assert.deepEqual(detail.appIDs, ['ABCDE12345.com.madebyjimbob.app']);
    assert.ok(detail.components.some((c) => c['/'] === '/watch/*'));
  } finally {
    delete process.env.APPLE_TEAM_ID;
  }
});
