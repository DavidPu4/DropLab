import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { APP_ORIGIN, MAX_BODY_BYTES, createProtocolHandler, isAppURL, isAllowedExternalURL, resolveAssetPath } = require('../desktop/protocol.cjs');
const request = (endpoint, input = {}, extra = {}) => new Request(`${APP_ORIGIN}${endpoint}`, {
  method: 'POST', headers: { Origin: APP_ORIGIN, 'Content-Type': 'application/json', ...extra.headers },
  body: JSON.stringify(input), ...Object.fromEntries(Object.entries(extra).filter(([key]) => key !== 'headers')),
});

test('desktop API accepts the bundled origin and preserves provider result/error boundaries', async () => {
  let received;
  const handler = createProtocolHandler({ rendererRoot: os.tmpdir(), discoveryAction: async input => {
    received = input;
    return { status: 'READY', runId: 'DesktopRun123456' };
  } });
  const response = await handler(request('/api/discovery', { action: 'start', token: 'example-not-real', acceptProviderCosts: true }));
  assert.equal(response.status, 200);
  assert.equal(received.token, 'example-not-real');
  assert.deepEqual(await response.json(), { status: 'READY', runId: 'DesktopRun123456' });
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(response.headers.get('access-control-allow-origin'), APP_ORIGIN);

  const failing = createProtocolHandler({ rendererRoot: os.tmpdir(), discoveryAction: async () => { throw new Error('private-error-details'); } });
  const failure = await failing(request('/api/discovery', { action: 'status' }));
  assert.equal(failure.status, 500);
  assert.ok(!(await failure.text()).includes('private-error-details'));
});

test('foreign and missing renderer origins cannot invoke provider operations', async () => {
  let calls = 0;
  const handler = createProtocolHandler({ rendererRoot: os.tmpdir(), discoveryAction: async () => { calls++; return {}; } });
  const cases = [
    request('/api/discovery', {}, { headers: { Origin: 'https://example.com' } }),
    request('/api/discovery', {}, { headers: { Origin: 'null' } }),
    new Request(`${APP_ORIGIN}/api/discovery`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }),
    new Request('droplab://other/api/discovery', { method: 'POST', headers: { Origin: APP_ORIGIN, 'Content-Type': 'application/json' }, body: '{}' }),
  ];
  const forgedInitiator = request('/api/discovery');
  Object.defineProperty(forgedInitiator, 'initiatorOrigin', { value: 'https://attacker.example' });
  cases.push(forgedInitiator);
  for (const item of cases) assert.equal((await handler(item)).status, 403);
  assert.equal(calls, 0);
});

test('trusted native initiator permits Chromium requests without an Origin header', async () => {
  const handler = createProtocolHandler({ rendererRoot: os.tmpdir(), discoveryAction: async () => ({ status: 'RUNNING' }) });
  const item = new Request(`${APP_ORIGIN}/api/discovery`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  Object.defineProperty(item, 'initiatorOrigin', { value: APP_ORIGIN });
  assert.equal((await handler(item)).status, 200);
});

test('oversized, malformed, and non-JSON desktop requests never reach a provider', async () => {
  let calls = 0;
  const handler = createProtocolHandler({ rendererRoot: os.tmpdir(), discoveryAction: async () => { calls++; return {}; } });
  assert.equal((await handler(request('/api/discovery', { notes: 'x'.repeat(MAX_BODY_BYTES) }))).status, 413);
  const badJSON = new Request(`${APP_ORIGIN}/api/discovery`, { method: 'POST', headers: { Origin: APP_ORIGIN, 'Content-Type': 'application/json' }, body: '{oops' });
  assert.equal((await handler(badJSON)).status, 400);
  assert.equal((await handler(request('/api/discovery', {}, { headers: { 'Content-Type': 'text/plain' } }))).status, 415);
  assert.equal((await handler(new Request(`${APP_ORIGIN}/api/discovery`, { headers: { Origin: APP_ORIGIN } }))).status, 405);
  assert.equal(calls, 0);
});

test('only packaged renderer assets are served with a restrictive CSP', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'droplab-assets-test-'));
  await fs.writeFile(path.join(root, 'index.html'), '<h1>DropLab</h1>');
  await fs.writeFile(path.join(root, 'icon.svg'), '<svg/>');
  t.after(async () => { await fs.unlink(path.join(root, 'index.html')); await fs.unlink(path.join(root, 'icon.svg')); await fs.rmdir(root); });
  const handler = createProtocolHandler({ rendererRoot: root });
  const response = await handler(new Request(`${APP_ORIGIN}/`));
  assert.equal(response.status, 200);
  assert.equal(await response.text(), '<h1>DropLab</h1>');
  const csp = response.headers.get('content-security-policy');
  assert.ok(csp.includes("script-src 'self'") && csp.includes("connect-src 'self'") && csp.includes("object-src 'none'"));
  assert.ok(!csp.includes('unsafe-eval'));
  const head = await handler(new Request(`${APP_ORIGIN}/icon.svg`, { method: 'HEAD' }));
  assert.equal(head.status, 200);
  assert.equal(await head.text(), '');
  assert.equal(head.headers.get('content-type'), 'image/svg+xml');
  for (const target of ['/../secret.txt', '/%2e%2e/secret.txt', '/%5c..%5csecret.txt', '/file.pem', '/%00.js', '/bad%zz.js']) {
    assert.equal(resolveAssetPath(root, target), null, target);
  }
  assert.equal((await handler(new Request(`${APP_ORIGIN}/missing.js`))).status, 404);
});

test('native external navigation permits HTTPS links and rejects executable protocols', () => {
  assert.equal(isAllowedExternalURL('https://www.tiktok.com/shop/pdp/example/123456789'), true);
  for (const target of ['file:///C:/Windows/System32/cmd.exe', 'javascript:alert(1)', 'http://example.com', 'https://name:pass@example.com', 'https://example.com:444/']) assert.equal(isAllowedExternalURL(target), false);
  assert.equal(isAppURL('droplab://app/'), true);
  assert.equal(isAppURL('droplab://app.evil.example/'), false);
});
