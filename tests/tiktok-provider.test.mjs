import test from 'node:test';
import assert from 'node:assert/strict';
import { DISCOVERY_PROVIDER, DiscoveryError, discoveryAction, normalizeTikTokRows } from '../lib/tiktok-provider.js';

const token = 'apify_api_test_only_123456789';
const runId = 'TikRun12345678901';
const datasetId = 'TikData1234567890';
const actorId = '4w4H1No6z1QNbhUWn';
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const run = (overrides = {}) => ({ id: runId, actId: actorId, status: 'RUNNING', ...overrides });
const row = (overrides = {}) => ({
  rowType: 'product', productId: '1729405526044283782', title: 'Example body oil',
  url: 'https://www.tiktok.com/shop/pdp/example-body-oil/1729405526044283782',
  image: 'https://p16-oec-general-useast5.ttcdn-us.com/example.webp',
  price: 22.03, currency: 'USD', rating: 4.6, reviewCount: 21362, soldCount: 300940,
  sellerName: 'Example Seller', sellerUrl: 'https://www.tiktok.com/shop/store/example/7495314676173147014',
  position: 1, region: 'US', scrapedAt: '2020-10-05T06:06:08.682Z', ...overrides,
});

test('experimental source metadata is fixed to the publicly verified actor', () => {
  assert.equal(DISCOVERY_PROVIDER.actor, 'wheaten_steelpan/tiktok-shop-scraper');
  assert.equal(DISCOVERY_PROVIDER.actorId, actorId);
  assert.equal(DISCOVERY_PROVIDER.experimental, true);
  assert.equal(DISCOVERY_PROVIDER.maxChargeUsd, 0.25);
});

test('discovery makes no request before token, consent, and bounded input are valid', async () => {
  let requests = 0;
  const options = { fetchImpl: async () => { requests++; throw Error('unexpected'); } };
  for (const input of [
    { action: 'start', acceptProviderCosts: true },
    { action: 'start', token },
    { action: 'start', token, acceptProviderCosts: true, maxResults: 0 },
    { action: 'start', token, acceptProviderCosts: true, maxResults: 51 },
    { action: 'start', token, acceptProviderCosts: true, maxResults: 10.5 },
    { action: 'status', token, runId: '../users/me' },
    { action: 'invalid', token },
  ]) await assert.rejects(discoveryAction(input, options), DiscoveryError);
  assert.equal(requests, 0);
});

test('start requests US bestsellers without keywords at a fixed cost and timeout', async () => {
  let request;
  const result = await discoveryAction({ action: 'start', token, acceptProviderCosts: true, actor: 'attacker/wrong', keyword: 'ignored' }, {
    fetchImpl: async (url, options) => { request = { url, options }; return json({ data: run({ status: 'READY' }) }); },
  });
  assert.deepEqual(result, { runId, status: 'READY', maxChargeUsd: 0.25 });
  const url = new URL(request.url);
  assert.equal(url.origin, 'https://api.apify.com');
  assert.equal(url.pathname, '/v2/acts/wheaten_steelpan~tiktok-shop-scraper/runs');
  assert.equal(url.searchParams.get('maxTotalChargeUsd'), '0.25');
  assert.equal(url.searchParams.get('timeout'), '180');
  assert.equal(url.searchParams.has('token'), false);
  assert.equal(request.options.headers.Authorization, `Bearer ${token}`);
  assert.equal(request.options.redirect, 'error');
  assert.deepEqual(JSON.parse(request.options.body), { mode: 'bestsellers', bestsellersRegion: 'US', maxResults: 30, trackSoldSinceLastRun: false });
});

test('status reads only the authenticated run dataset and keeps observed lifetime metrics', async () => {
  const requests = [];
  const result = await discoveryAction({ action: 'status', token, runId, datasetId: 'InjectedData1234' }, {
    fetchImpl: async (url) => {
      requests.push(url);
      return url.includes('/actor-runs/') ? json({ data: run({ status: 'SUCCEEDED', defaultDatasetId: datasetId, finishedAt: '2020-10-05T06:10:00.000Z' }) }) : json([row()]);
    },
  });
  assert.equal(requests.length, 2);
  assert.match(requests[1], new RegExp(`/datasets/${datasetId}/items`));
  assert.doesNotMatch(requests[1], /InjectedData/);
  assert.equal(result.leads.length, 1);
  assert.equal(result.leads[0].lifetimeSold, 300940);
  assert.equal(result.leads[0].observedAt, '2020-10-05T06:06:08.682Z');
  assert.equal(result.leads[0].acquisition, 'live');
  assert.equal(result.leads[0].listingPrice, 22.03);
  assert.equal(result.leads[0].market, 'US');
  assert.equal('profit' in result.leads[0], false);
  assert.equal('dailySales' in result.leads[0], false);
});

test('wrong actor runs cannot reveal a dataset or be cancelled', async () => {
  for (const action of ['status', 'cancel']) {
    let requests = 0;
    await assert.rejects(discoveryAction({ action, token, runId }, {
      fetchImpl: async () => { requests++; return json({ data: run({ actId: 'OtherActor123456', status: 'SUCCEEDED', defaultDatasetId: datasetId }) }); },
    }), (error) => error.code === 'source_mismatch');
    assert.equal(requests, 1);
  }
});

test('cancel verifies the source before aborting, and finished jobs are not aborted', async () => {
  const requests = [];
  const result = await discoveryAction({ action: 'cancel', token, runId }, { fetchImpl: async (url, options) => {
    requests.push({ url, options });
    return json({ data: run({ status: url.endsWith('/abort') ? 'ABORTING' : 'RUNNING' }) });
  } });
  assert.equal(requests.length, 2);
  assert.equal(requests[0].options.method, 'GET');
  assert.equal(requests[1].url, `https://api.apify.com/v2/actor-runs/${runId}/abort`);
  assert.equal(requests[1].options.method, 'POST');
  assert.equal(result.status, 'ABORTING');
  let terminalRequests = 0;
  const terminal = await discoveryAction({ action: 'cancel', token, runId }, { fetchImpl: async () => { terminalRequests++; return json({ data: run({ status: 'SUCCEEDED' }) }); } });
  assert.equal(terminalRequests, 1);
  assert.equal(terminal.status, 'SUCCEEDED');
});

test('pending, failed, and exhausted-source results never become demo leads', async () => {
  for (const status of ['READY', 'RUNNING', 'FAILED', 'TIMED-OUT', 'ABORTED']) {
    const result = await discoveryAction({ action: 'status', token, runId }, { fetchImpl: async () => json({ data: run({ status }) }) });
    assert.deepEqual(result, { runId, status });
  }
  const empty = await discoveryAction({ action: 'status', token, runId }, { fetchImpl: async (url) => url.includes('/actor-runs/') ? json({ data: run({ status: 'SUCCEEDED', defaultDatasetId: datasetId }) }) : json([]) });
  assert.deepEqual(empty.leads, []);
  assert.match(empty.warning, /upstream outage/);
});

test('provider errors do not reveal raw details or tokens', async () => {
  for (const status of [401, 402, 403, 404, 429, 500]) {
    await assert.rejects(discoveryAction({ action: 'status', token, runId }, { fetchImpl: async () => json({ error: { message: `${token} secret-provider-details` } }, status) }), (error) => {
      assert.equal(error instanceof DiscoveryError, true);
      assert.doesNotMatch(error.message, /apify_api_test_only|secret-provider-details/);
      return true;
    });
  }
});

test('ambiguous start transport failure is not retried automatically', async () => {
  let requests = 0;
  await assert.rejects(discoveryAction({ action: 'start', token, acceptProviderCosts: true }, { fetchImpl: async () => { requests++; throw Error(token); } }), (error) => {
    assert.match(error.message, /may already have started/);
    assert.doesNotMatch(error.message, /apify_api_test_only/);
    return true;
  });
  assert.equal(requests, 1);
});

test('malformed and oversized provider responses are rejected', async () => {
  for (const response of [new Response('not JSON'), new Response('{}', { headers: { 'content-length': '3000000' } })]) {
    await assert.rejects(discoveryAction({ action: 'status', token, runId }, { fetchImpl: async () => response }), DiscoveryError);
  }
  assert.throws(() => normalizeTikTokRows({ items: [] }), DiscoveryError);
});

test('normalization deduplicates and excludes non-US, unsafe and nonproduct rows', () => {
  const leads = normalizeTikTokRows([
    row(), row(), row({ rowType: 'store' }), row({ productId: '1729405526044283783', region: 'GB', currency: 'GBP' }),
    row({ productId: '1729405526044283784', url: 'javascript:alert(1)' }),
    row({ productId: 1729405526044283782 }), row({ error: 'upstream_failure' }),
  ]);
  assert.equal(leads.length, 1);
  assert.equal(leads[0].productId, '1729405526044283782');
  assert.equal(leads[0].id, 'tiktok-1729405526044283782');
});

test('missing or empty market and currency cannot be promoted to US dollar listing evidence', () => {
  for (const patch of [
    { region: undefined }, { region: null }, { region: '' },
    { currency: undefined }, { currency: null }, { currency: '' },
    { region: undefined, currency: undefined },
  ]) assert.deepEqual(normalizeTikTokRows([row(patch)]), []);
});

test('old and unknown scrape times stay old or unknown, never import-time fresh', () => {
  const runDate = '2020-01-01T00:00:00.000Z';
  const old = normalizeTikTokRows([row({ scrapedAt: null })], runDate)[0];
  assert.equal(old.observedAt, runDate);
  assert.equal(normalizeTikTokRows([row({ scrapedAt: null })])[0].observedAt, null);
  assert.equal(normalizeTikTokRows([row({ scrapedAt: '2099-01-01' })], '2099-01-01')[0].observedAt, null);
  assert.equal(normalizeTikTokRows([row({ scrapedAt: 'invalid' })], runDate)[0].observedAt, runDate);
});
