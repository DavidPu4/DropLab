import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { Miniflare } from 'miniflare';

// Exercise the actual provider modules inside the same Workers runtime used by
// Wrangler. Node's Request accepts redirect:'error'; Workers' Request rejects it.
// Every outbound request is mocked, so this test uses no account or credits.
test('both providers create Workers-compatible requests and never follow redirects', async () => {
  const bundled = await build({
    absWorkingDir: fileURLToPath(new URL('../', import.meta.url)),
    stdin: { resolveDir: fileURLToPath(new URL('../', import.meta.url)), contents: `
      import { discoveryAction } from './lib/tiktok-provider.js';
      import { researchAction } from './lib/research-provider.js';
      export default { async fetch() {
        const results = [];
        for (const kind of ['discovery', 'ads']) {
          for (const redirectResponse of [false, true]) {
            const requests = [];
            const fetchImpl = async (url, init) => {
              const request = new Request(url, init);
              requests.push({ redirect: request.redirect, host: new URL(request.url).hostname, method: request.method });
              return redirectResponse
                ? new Response('Do not expose provider bodies', { status: 302, headers: { Location: 'https://example.com/untrusted' } })
                : Response.json({ data: { id: 'Run1234567890Abcd', actId: '4w4H1No6z1QNbhUWn', status: 'READY' } });
            };
            const input = { action: 'start', token: 'test_token_not_real_1234', acceptProviderCosts: true, maxResults: 30,
              libraryUrl: 'https://www.facebook.com/ads/library/?q=desk' };
            try {
              const result = await (kind === 'discovery' ? discoveryAction : researchAction)(input, { fetchImpl });
              results.push({ kind, redirectResponse, requests, status: result.status });
            } catch (error) {
              results.push({ kind, redirectResponse, requests, errorCode: error.code, errorStatus: error.status });
            }
          }
        }
        return Response.json(results);
      } };
    ` },
    bundle: true, write: false, format: 'esm', platform: 'browser', target: 'es2022',
  });
  const worker = new Miniflare({
    modules: true, script: bundled.outputFiles[0].text, cf: false, inspectorPort: 0,
    compatibilityDate: '2026-05-15', compatibilityFlags: ['nodejs_compat'],
  });
  try {
    const response = await worker.dispatchFetch('http://localhost/');
    const results = await response.json();
    assert.equal(results.length, 4);
    for (const result of results) {
      assert.deepEqual(result.requests, [{ redirect: 'manual', host: 'api.apify.com', method: 'POST' }]);
      if (result.redirectResponse) {
        assert.equal(result.errorCode, 'provider_redirect');
        assert.equal(result.errorStatus, 502);
      } else {
        assert.equal(result.status, 'READY');
      }
    }
  } finally {
    await worker.dispose();
  }
});
