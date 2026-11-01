/** Optional, user-triggered Apify integration. No token is persisted or logged. */
export const RESEARCH_PROVIDER = Object.freeze({
  actor: 'apify/facebook-ads-scraper',
  setupUrl: 'https://apify.com/apify/facebook-ads-scraper',
  tokenUrl: 'https://console.apify.com/settings/integrations',
  maxResults: 50,
  maxChargeUsd: 1,
});

const API = 'https://api.apify.com/v2';
const ID = /^[A-Za-z0-9]{8,64}$/;
const RUN_STATUSES = new Set(['READY', 'RUNNING', 'SUCCEEDED', 'FAILED', 'TIMING-OUT', 'TIMED-OUT', 'ABORTING', 'ABORTED']);

export class ResearchError extends Error {
  constructor(message, status = 400, code = 'invalid_request') {
    super(message);
    this.name = 'ResearchError';
    this.status = status;
    this.code = code;
  }
}

function text(value, max = 500) {
  return typeof value === 'string' ? value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').trim().slice(0, max) : '';
}

function creativeText(value, max) {
  const result = text(value, max);
  // Dynamic catalog ads may contain unresolved Meta placeholders, not product names.
  return /\{\{|\}\}/.test(result) ? '' : result;
}

function observationDate(value) {
  if (typeof value !== 'string' || value.length > 64) return null;
  const timestamp = Date.parse(value);
  // Never manufacture freshness on import, including from future provider dates.
  return Number.isFinite(timestamp) && timestamp <= Date.now() ? new Date(timestamp).toISOString() : null;
}

function safeUrl(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || value.length > 3000) return '';
    return url.href;
  } catch { return ''; }
}

export function validateLibraryUrl(value) {
  if (typeof value !== 'string' || value.length > 3000) throw new ResearchError('Paste a Meta Ad Library search URL.');
  let url;
  try { url = new URL(value); } catch { throw new ResearchError('Paste a valid Meta Ad Library search URL.'); }
  if (url.protocol !== 'https:' || !['facebook.com', 'www.facebook.com'].includes(url.hostname) ||
      !/^\/ads\/library\/?$/.test(url.pathname) || url.username || url.password || url.port) {
    throw new ResearchError('Use an HTTPS URL from facebook.com/ads/library.');
  }
  if (!url.searchParams.get('q') && !url.searchParams.get('view_all_page_id') && !url.searchParams.get('id')) {
    throw new ResearchError('Search Meta Ad Library first, then paste a URL containing a keyword, page ID, or ad ID.');
  }
  url.hash = '';
  return url.href;
}

function validateToken(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{10,300}$/.test(value.trim())) {
    throw new ResearchError('Enter your Apify API token. It is used for this session only.', 400, 'token_required');
  }
  return value.trim();
}

function validateId(value, label = 'run') {
  if (typeof value !== 'string' || !ID.test(value)) throw new ResearchError(`Invalid ${label} ID.`);
  return value;
}

function safeStatus(value) {
  if (!RUN_STATUSES.has(value)) throw new ResearchError('Apify returned an unrecognized run status. Check the run in your Apify console.', 502, 'provider_response');
  return value;
}

async function providerJson(path, token, options, fetchImpl) {
  let response;
  try {
    response = await fetchImpl(`${API}${path}`, {
      ...options,
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', 'Content-Type': 'application/json' },
      redirect: 'error',
      signal: AbortSignal.timeout(15000),
    });
  } catch {
    throw new ResearchError('Could not reach Apify. If you started a search, check your Apify console before retrying: a run may already have started.', 502, 'provider_unreachable');
  }
  if (!response.ok) {
    // Never relay provider messages: they can contain request details or credentials.
    const messages = {
      401: ['Apify rejected the token. Check your API token and permissions.', 401],
      403: ['Apify denied access. Check your token permissions and actor access in Apify.', 403],
      402: ['Apify requires additional credits or actor access. You can continue with manual products or CSV imports.', 402],
      404: ['The Apify actor or run was not found. Check your run in the Apify console.', 404],
      429: ['Apify is rate limiting requests. Wait before checking again.', 429],
    };
    const [message, status] = messages[response.status] ?? ['Apify could not complete this request. Check the run in your Apify console.', 502];
    throw new ResearchError(message, status, 'provider_error');
  }
  const contentLength = Number(response.headers.get('content-length'));
  if (contentLength > 2_000_000) throw new ResearchError('Apify returned too much data. Use a smaller result limit.', 502, 'provider_response');
  try {
    const reader = response.body?.getReader();
    if (!reader) throw new Error('Empty response');
    const chunks = [];
    let size = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 2_000_000) { await reader.cancel(); throw new Error('Response too large'); }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new ResearchError('Apify returned unreadable data. Check the run in your Apify console.', 502, 'provider_response');
  }
}

/** Each row is an observed ad lead, never a verified product or a market-wide count. */
export function normalizeResearchAds(rows, observedAt = null) {
  if (!Array.isArray(rows)) throw new ResearchError('Apify did not return an ad list.', 502, 'provider_response');
  const observationTime = observationDate(observedAt);
  const seen = new Set();
  return rows.slice(0, 50).flatMap((row) => {
    if (!row || typeof row !== 'object' || row.error) return [];
    const adId = text(String(row.adArchiveID ?? row.adArchiveId ?? row.ad_archive_id ?? ''), 80);
    if (!/^\d{5,80}$/.test(adId) || seen.has(adId)) return [];
    seen.add(adId);
    const snapshot = row.snapshot && typeof row.snapshot === 'object' ? row.snapshot : {};
    const cards = Array.isArray(snapshot.cards) ? snapshot.cards.filter(value => value && typeof value === 'object') : [];
    const card = cards[0] ?? {};
    const title = [snapshot.title, ...cards.map(value => value.title), row.title].map(value => creativeText(value, 140)).find(Boolean) ?? '';
    const pageName = creativeText(snapshot.pageName ?? row.pageName ?? row.page_name, 100);
    const body = creativeText(typeof snapshot.body === 'object' ? snapshot.body?.text : snapshot.body ?? card.body ?? row.bodyText, 1500);
    const active = typeof row.isActive === 'boolean' ? row.isActive : typeof row.is_active === 'boolean' ? row.is_active : null;
    const pageId = text(String(row.pageID ?? row.pageId ?? row.page_id ?? snapshot.pageId ?? ''), 80);
    const landingUrl = safeUrl(snapshot.linkUrl ?? card.linkUrl ?? row.linkUrl ?? row.link_url ?? '');
    const sourceUrl = `https://www.facebook.com/ads/library/?id=${adId}`;
    const start = text(row.startDateFormatted ?? row.start_date_formatted, 60);
    return [{
      id: `apify-${adId}`, name: title || (pageName ? `${pageName} — ad lead` : `Ad lead ${adId}`),
      category: 'Uncategorized', sourceUrl, supplierUrl: '', observedAt: observationTime, sourceType: 'apify', currency: 'USD',
      sellingPrice: null, unitCost: null, shippingCost: null, feePercent: null, feeFixed: null, refundRate: null,
      activeAds: active === null ? null : active ? 1 : 0,
      totalAds: 1, distinctAdvertisers: pageId ? 1 : null,
      firstSeenAt: null, lastSeenAt: observationTime, decision: 'watch', tags: ['Ad lead', 'Needs product validation'],
      notes: [
        'Imported observation: one ad, not a verified product. Counts describe this observed ad only; they do not measure the entire market or profitability.',
        pageName && `Advertiser: ${pageName}.`,
        `Active status: ${active === null ? 'not reported' : active ? 'reported active' : 'reported inactive'}.`,
        start && `Provider-reported ad start: ${start}.`,
        landingUrl && `Advertised destination (not a verified supplier): ${landingUrl}`,
        body && `Ad copy: ${body}`,
      ].filter(Boolean).join('\n'),
    }];
  });
}

export async function researchAction(input, { fetchImpl = globalThis.fetch } = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new ResearchError('Expected a JSON request.');
  if (!['start', 'status', 'cancel'].includes(input.action)) throw new ResearchError('Unknown research action.');
  const token = validateToken(input.token);
  if (input.action === 'start') {
    if (input.acceptProviderCosts !== true) throw new ResearchError('Confirm that this search can use your Apify credits before starting.', 400, 'cost_consent_required');
    const libraryUrl = validateLibraryUrl(input.libraryUrl);
    const maxResults = input.maxResults ?? 20;
    if (!Number.isInteger(maxResults) || maxResults < 10 || maxResults > 50) throw new ResearchError('Choose a result limit between 10 and 50.');
    const result = await providerJson('/acts/apify~facebook-ads-scraper/runs?timeout=180&maxTotalChargeUsd=1&restartOnError=false', token, {
      method: 'POST', body: JSON.stringify({ startUrls: [{ url: libraryUrl }], resultsLimit: maxResults, onlyTotal: false, includeAboutPage: false, isDetailsPerAd: false, enrichWithEcommerceData: false }),
    }, fetchImpl);
    return { runId: validateId(result?.data?.id), status: safeStatus(result?.data?.status), maxChargeUsd: 1 };
  }
  const runId = validateId(input.runId);
  if (input.action === 'cancel') {
    const result = await providerJson(`/actor-runs/${runId}/abort`, token, { method: 'POST', body: '{}' }, fetchImpl);
    return { runId, status: safeStatus(result?.data?.status) };
  }
  const result = await providerJson(`/actor-runs/${runId}`, token, { method: 'GET' }, fetchImpl);
  const status = safeStatus(result?.data?.status);
  if (status !== 'SUCCEEDED') return { runId, status };
  const datasetId = validateId(result?.data?.defaultDatasetId, 'dataset');
  const rows = await providerJson(`/datasets/${datasetId}/items?format=json&clean=true&limit=50`, token, { method: 'GET' }, fetchImpl);
  const observedAt = observationDate(result?.data?.finishedAt) ?? observationDate(result?.data?.startedAt);
  return { runId, status, products: normalizeResearchAds(rows, observedAt) };
}
