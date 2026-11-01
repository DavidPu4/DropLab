import { normalizeDiscoveryLead } from './discovery.js';

/** Experimental third-party source. Runs are only started on an explicit user action. */
export const DISCOVERY_PROVIDER = Object.freeze({
  actor: 'wheaten_steelpan/tiktok-shop-scraper',
  actorId: '4w4H1No6z1QNbhUWn', // Verified against Apify's public actor metadata.
  setupUrl: 'https://apify.com/wheaten_steelpan/tiktok-shop-scraper',
  tokenUrl: 'https://console.apify.com/settings/integrations',
  experimental: true,
  market: 'US',
  defaultResults: 30,
  maxResults: 50,
  maxChargeUsd: 0.25,
});

const API = 'https://api.apify.com/v2';
const ID = /^[A-Za-z0-9]{8,64}$/;
const STATUSES = new Set(['READY', 'RUNNING', 'SUCCEEDED', 'FAILED', 'TIMING-OUT', 'TIMED-OUT', 'ABORTING', 'ABORTED']);
const TERMINAL_STATUSES = new Set(['SUCCEEDED', 'FAILED', 'TIMED-OUT', 'ABORTED']);

export class DiscoveryError extends Error {
  constructor(message, status = 400, code = 'invalid_request') {
    super(message);
    this.name = 'DiscoveryError';
    this.status = status;
    this.code = code;
  }
}

function validateToken(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{10,300}$/.test(value.trim())) {
    throw new DiscoveryError('Enter your Apify API token to discover products. The token is used for this session only.', 400, 'token_required');
  }
  return value.trim();
}

function validateId(value, label = 'run') {
  if (typeof value !== 'string' || !ID.test(value)) throw new DiscoveryError(`Invalid ${label} ID.`);
  return value;
}

function validateRun(data) {
  if (!data || data.actId !== DISCOVERY_PROVIDER.actorId) {
    throw new DiscoveryError('This run does not belong to DropLab’s configured TikTok discovery source.', 400, 'source_mismatch');
  }
  if (!STATUSES.has(data.status)) throw new DiscoveryError('Apify returned an unrecognized run status. Check the run in your Apify console.', 502, 'provider_response');
  return data;
}

function observationDate(value) {
  if (typeof value !== 'string' || value.length > 64) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && parsed <= Date.now() ? new Date(parsed).toISOString() : null;
}

async function providerJson(path, token, options, fetchImpl) {
  let response;
  try {
    response = await fetchImpl(`${API}${path}`, {
      ...options,
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', 'Content-Type': 'application/json' },
      redirect: 'error', signal: AbortSignal.timeout(15000),
    });
  } catch {
    // No automatic start retry: a timed-out response does not prove the paid run failed to start.
    throw new DiscoveryError('Could not reach Apify. If you started discovery, check your Apify console before retrying: a run may already have started.', 502, 'provider_unreachable');
  }
  if (!response.ok) {
    // Provider error bodies can contain request details. Only return our fixed messages.
    const messages = {
      401: ['Apify rejected the token. Check your API token and permissions.', 401],
      402: ['Apify requires available credits or source access. DropLab will not add a billing plan for you.', 402],
      403: ['Apify denied access. Check token permissions and source access in your Apify account.', 403],
      404: ['The TikTok discovery source or run was not found. Check your Apify console.', 404],
      429: ['Apify is rate limiting requests. Wait before checking again.', 429],
    };
    const [message, status] = messages[response.status] ?? ['The experimental TikTok discovery source could not complete this request. Check the run in your Apify console.', 502];
    throw new DiscoveryError(message, status, 'provider_error');
  }
  if (Number(response.headers.get('content-length')) > 2_000_000) {
    throw new DiscoveryError('The discovery source returned too much data. Check the run in your Apify console.', 502, 'provider_response');
  }
  try {
    const reader = response.body?.getReader();
    if (!reader) throw Error('Empty response');
    const chunks = [];
    let size = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 2_000_000) { await reader.cancel(); throw Error('Oversized response'); }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new DiscoveryError('The discovery source returned unreadable data. Check the run in your Apify console.', 502, 'provider_response');
  }
}

/** Preserve provider observations; soldCount is lifetime sales, never daily sales or profit. */
export function normalizeTikTokRows(rows, runObservedAt = null) {
  if (!Array.isArray(rows)) throw new DiscoveryError('The discovery source did not return a product list.', 502, 'provider_response');
  const fallbackDate = observationDate(runObservedAt);
  const seen = new Set();
  const leads = [];
  for (const row of rows.slice(0, 50)) {
    if (!row || typeof row !== 'object' || row.error || row.rowType !== 'product') continue;
    // The same actor supports other markets. Never infer a price's currency or market.
    if (row.region !== 'US' || row.currency !== 'USD') continue;
    if (typeof row.productId === 'number' && !Number.isSafeInteger(row.productId)) continue;
    const productId = typeof row.productId === 'string' || typeof row.productId === 'number' ? String(row.productId) : '';
    if (!/^\d{5,40}$/.test(productId) || seen.has(productId)) continue;
    try {
      const lead = normalizeDiscoveryLead({
        id: `tiktok-${productId}`, productId,
        name: row.title, productUrl: row.url, imageUrl: row.image,
        sellerName: row.sellerName, sellerUrl: row.sellerUrl,
        listingPrice: row.price, currency: 'USD', lifetimeSold: row.soldCount,
        rating: row.rating, reviewCount: row.reviewCount, rank: row.position,
        observedAt: observationDate(row.scrapedAt) ?? fallbackDate,
        market: 'US', acquisition: 'live',
      });
      if (lead) { seen.add(productId); leads.push(lead); }
    } catch { /* One malformed third-party row must not discard the valid observations. */ }
  }
  return leads;
}

export async function discoveryAction(input, { fetchImpl = globalThis.fetch } = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new DiscoveryError('Expected a JSON request.');
  if (!['start', 'status', 'cancel'].includes(input.action)) throw new DiscoveryError('Unknown discovery action.');
  const token = validateToken(input.token);
  if (input.action === 'start') {
    if (input.acceptProviderCosts !== true) throw new DiscoveryError('Confirm that discovery may use your Apify credits before starting.', 400, 'cost_consent_required');
    const maxResults = input.maxResults ?? DISCOVERY_PROVIDER.defaultResults;
    if (!Number.isInteger(maxResults) || maxResults < 10 || maxResults > 50) throw new DiscoveryError('Choose a result limit between 10 and 50.');
    const result = await providerJson('/acts/wheaten_steelpan~tiktok-shop-scraper/runs?timeout=180&maxTotalChargeUsd=0.25&restartOnError=false', token, {
      method: 'POST',
      body: JSON.stringify({ mode: 'bestsellers', bestsellersRegion: 'US', maxResults, trackSoldSinceLastRun: false }),
    }, fetchImpl);
    const run = validateRun(result?.data);
    return { runId: validateId(run.id), status: run.status, maxChargeUsd: DISCOVERY_PROVIDER.maxChargeUsd };
  }
  const runId = validateId(input.runId);
  // The caller's own token controls access. Verify the fixed actor before reading a dataset or aborting.
  const result = await providerJson(`/actor-runs/${runId}`, token, { method: 'GET' }, fetchImpl);
  const run = validateRun(result?.data);
  if (input.action === 'cancel') {
    if (TERMINAL_STATUSES.has(run.status)) return { runId, status: run.status };
    const result = await providerJson(`/actor-runs/${runId}/abort`, token, { method: 'POST', body: '{}' }, fetchImpl);
    return { runId, status: validateRun(result?.data).status };
  }
  if (run.status !== 'SUCCEEDED') return { runId, status: run.status };
  const datasetId = validateId(run.defaultDatasetId, 'dataset');
  const rows = await providerJson(`/datasets/${datasetId}/items?format=json&clean=true&limit=50`, token, { method: 'GET' }, fetchImpl);
  const observedAt = observationDate(run.finishedAt) ?? observationDate(run.startedAt);
  const leads = normalizeTikTokRows(rows, observedAt);
  return {
    runId, status: run.status, leads,
    ...(!leads.length ? { warning: 'The experimental TikTok source returned no usable US products. An empty bestseller list can indicate an upstream outage; check this run in Apify before trying again.' } : {}),
  };
}
