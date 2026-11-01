import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeResearchAds, researchAction, validateLibraryUrl, ResearchError } from '../lib/research-provider.js';

const token = 'apify_api_test_only_123456789';
const libraryUrl = 'https://www.facebook.com/ads/library/?q=pet+grooming&country=US&active_status=active';
const runId = 'Abc12345678901234';
const datasetId = 'Data1234567890123';
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

test('library URLs reject lookalikes, arbitrary endpoints, credentials and absent searches', () => {
  assert.match(validateLibraryUrl(libraryUrl), /facebook\.com\/ads\/library/);
  for (const value of ['https://facebook.com.evil.test/ads/library/?q=test', 'https://127.0.0.1/ads/library/?q=test', 'http://facebook.com/ads/library/?q=test', 'https://facebook.com@evil.test/ads/library/?q=test', 'https://www.facebook.com/login/?q=test', 'https://www.facebook.com/ads/library/']) {
    assert.throws(() => validateLibraryUrl(value), ResearchError);
  }
});

test('no outbound requests before token, consent, URL, and result limits are valid', async () => {
  let calls = 0;
  const options = { fetchImpl: async () => { calls++; throw Error('unexpected'); } };
  for (const input of [
    { action: 'start', libraryUrl, acceptProviderCosts: true },
    { action: 'start', token, libraryUrl },
    { action: 'start', token, libraryUrl, acceptProviderCosts: true, maxResults: 0 },
    { action: 'start', token, libraryUrl, acceptProviderCosts: true, maxResults: 51 },
    { action: 'status', token, runId: '../users/me' },
    { action: 'delete', token },
  ]) await assert.rejects(researchAction(input, options), ResearchError);
  assert.equal(calls, 0);
});

test('start uses a fixed official actor, authorization header, bounded cost/time and results', async () => {
  let requested;
  const result = await researchAction({ action: 'start', token, libraryUrl, acceptProviderCosts: true, maxResults: 20 }, {
    fetchImpl: async (url, options) => { requested = { url, options }; return json({ data: { id: runId, status: 'READY' } }); },
  });
  assert.deepEqual(result, { runId, status: 'READY', maxChargeUsd: 1 });
  const url = new URL(requested.url);
  assert.equal(url.origin, 'https://api.apify.com');
  assert.equal(url.pathname, '/v2/acts/apify~facebook-ads-scraper/runs');
  assert.equal(url.searchParams.get('maxTotalChargeUsd'), '1');
  assert.equal(url.searchParams.get('timeout'), '180');
  assert.equal(url.searchParams.has('token'), false);
  assert.equal(requested.options.headers.Authorization, `Bearer ${token}`);
  assert.equal(requested.options.redirect, 'manual');
  const input = JSON.parse(requested.options.body);
  assert.deepEqual(input.startUrls, [{ url: libraryUrl }]);
  assert.equal(input.resultsLimit, 20);
  assert.equal(input.enrichWithEcommerceData, false);
});

test('status only reads the dataset returned by the token-authenticated run', async () => {
  const calls = [];
  const result = await researchAction({ action: 'status', token, runId, datasetId: 'InjectedDataset' }, {
    fetchImpl: async (url) => {
      calls.push(url);
      return url.includes('/actor-runs/') ? json({ data: { status: 'SUCCEEDED', defaultDatasetId: datasetId } }) : json([{ adArchiveId: '123456789', snapshot: { title: 'Pet brush' } }]);
    },
  });
  assert.equal(calls.length, 2);
  assert.match(calls[1], new RegExp(`/datasets/${datasetId}/items`));
  assert.doesNotMatch(calls[1], /InjectedDataset/);
  assert.equal(result.products[0].sourceType, 'apify');
  assert.equal(result.products[0].sellingPrice, null);
});

test('pending and failed runs do not read a dataset or fabricate results', async () => {
  for (const status of ['READY', 'RUNNING', 'FAILED', 'TIMED-OUT', 'ABORTED']) {
    let calls = 0;
    const result = await researchAction({ action: 'status', token, runId }, { fetchImpl: async () => { calls++; return json({ data: { status } }); } });
    assert.deepEqual(result, { runId, status });
    assert.equal(calls, 1);
  }
});

test('cancel only posts to the fixed provider run abort endpoint', async () => {
  let called;
  const result = await researchAction({ action: 'cancel', token, runId }, { fetchImpl: async (url, options) => { called = { url, options }; return json({ data: { status: 'ABORTING' } }); } });
  assert.equal(called.url, `https://api.apify.com/v2/actor-runs/${runId}/abort`);
  assert.equal(called.options.method, 'POST');
  assert.equal(result.status, 'ABORTING');
});

test('provider failure never relays raw provider details or token', async () => {
  for (const status of [401, 402, 403, 404, 429, 500]) {
    await assert.rejects(researchAction({ action: 'status', token, runId }, { fetchImpl: async () => json({ error: { message: `${token} ${libraryUrl} secret` } }, status) }), (error) => {
      assert.equal(error instanceof ResearchError, true);
      assert.doesNotMatch(error.message, /secret|apify_api_test_only|pet\+grooming/);
      return true;
    });
  }
});

test('redirects are rejected once without forwarding credentials or exposing the destination', async () => {
  for (const status of [301, 302, 303, 307, 308]) {
    let calls = 0;
    await assert.rejects(researchAction({ action: 'start', token, libraryUrl, acceptProviderCosts: true }, {
      fetchImpl: async (url, options) => {
        calls++;
        assert.equal(new URL(url).origin, 'https://api.apify.com');
        assert.equal(options.redirect, 'manual');
        return new Response(`${token} secret-response`, { status, headers: { location: 'https://attacker.example/secret-destination' } });
      },
    }), (error) => {
      assert.equal(error.code, 'provider_redirect');
      assert.equal(error.status, 502);
      assert.doesNotMatch(error.message, /apify_api_test_only|attacker|secret/);
      return true;
    });
    assert.equal(calls, 1);
  }
});

test('transport failures safely flag an ambiguous start rather than retrying a paid job', async () => {
  let calls = 0;
  await assert.rejects(researchAction({ action: 'start', token, libraryUrl, acceptProviderCosts: true }, { fetchImpl: async () => { calls++; throw Error(token); } }), (error) => {
    assert.match(error.message, /may already have started/);
    assert.doesNotMatch(error.message, /apify_api_test_only/);
    return true;
  });
  assert.equal(calls, 1);
});

test('normalization preserves unknown activity, rejects malformed ads, deduplicates and never invents costs', () => {
  const observedAt = '2020-11-01T12:00:00.000Z';
  const result = normalizeResearchAds([
    { adArchiveId: '123456', endDateFormatted: null, snapshot: { title: 'Brush', body: { text: 'Soft pet brush' }, linkUrl: 'javascript:alert(1)' } },
    { adArchiveId: '123456', isActive: true },
    { adArchiveId: '123457', isActive: false, pageId: '999', snapshot: { cards: [{ title: 'Second brush', linkUrl: 'https://shop.example/products/brush' }] } },
    { error: 'no_items' }, { pageName: 'No ID' },
  ], observedAt);
  assert.equal(result.length, 2);
  assert.equal(result[0].activeAds, null);
  assert.equal(result[1].activeAds, 0);
  assert.equal(result[0].totalAds, 1);
  assert.equal(result[0].distinctAdvertisers, null);
  assert.equal(result[0].firstSeenAt, null);
  assert.equal(result[0].observedAt, observedAt);
  assert.equal(result[0].sellingPrice, null);
  assert.equal(result[0].unitCost, null);
  assert.equal(result[0].supplierUrl, '');
  assert.match(result[1].notes, /not a verified supplier/);
  assert.doesNotMatch(result[0].notes, /javascript:/);
});

test('provider malformed or oversized data is rejected safely', async () => {
  for (const response of [new Response('not json'), new Response('{}', { headers: { 'content-length': '3000000' } })]) {
    await assert.rejects(researchAction({ action: 'status', token, runId }, { fetchImpl: async () => response }), ResearchError);
  }
  assert.throws(() => normalizeResearchAds({ wrong: true }), ResearchError);
});

test('import keeps the provider run observation date instead of making old evidence fresh', async () => {
  const startedAt = '2020-01-02T00:00:00.000Z';
  const finishedAt = '2020-01-02T00:03:00.000Z';
  for (const [dates, expected] of [
    [{ startedAt, finishedAt }, finishedAt],
    [{ startedAt }, startedAt],
    [{ startedAt, finishedAt: 'invalid' }, startedAt],
    [{ startedAt, finishedAt: '2099-01-01T00:00:00.000Z' }, startedAt],
    [{}, null],
    [{ finishedAt: '2099-01-01T00:00:00.000Z' }, null],
  ]) {
    const result = await researchAction({ action: 'status', token, runId }, {
      fetchImpl: async (url) => url.includes('/actor-runs/')
        ? json({ data: { status: 'SUCCEEDED', defaultDatasetId: datasetId, ...dates } })
        : json([{ adArchiveId: '123456789', snapshot: { title: 'Pet brush' } }]),
    });
    assert.equal(result.products[0].observedAt, expected);
    assert.equal(result.products[0].lastSeenAt, expected);
    assert.equal(result.products[0].firstSeenAt, null);
  }
  assert.equal(normalizeResearchAds([{ adArchiveId: '123456789' }])[0].observedAt, null);
  assert.equal(normalizeResearchAds([{ adArchiveId: '123456789' }], '2099-01-01')[0].observedAt, null);
});

test('unresolved catalog headlines fall back to a usable card headline or advertiser', () => {
  const results = normalizeResearchAds([
    { adArchiveId: '123456', snapshot: { title: '{{product.name}}', pageName: 'Brush Store', cards: [{ title: '{{product.brand}}' }, { title: 'Gentle grooming brush' }] } },
    { adArchiveId: '123457', snapshot: { title: 'Shop {{product.name}} today', pageName: 'Home Store', body: { text: '{{product.description}}' } } },
    { adArchiveId: '123458', snapshot: { title: '{{product.name}}' } },
  ]);
  assert.equal(results[0].name, 'Gentle grooming brush');
  assert.equal(results[1].name, 'Home Store — ad lead');
  assert.equal(results[2].name, 'Ad lead 123458');
  assert.ok(results.every(value => !/\{\{/.test(value.name + value.notes)));
});
