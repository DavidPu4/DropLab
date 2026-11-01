/** Canonical marketplace snapshots. Lifetime sales are never treated as recent sales. */
const MAX_PRICE = 1_000_000_000;
const text = (value, max = 160) => typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, max) : '';
const PRODUCT_ID = /^\d{5,30}$/;
const TIKTOK_HOSTS = new Set(['www.tiktok.com', 'tiktok.com', 'shop.tiktok.com']);
const IMAGE_DOMAINS = ['ttcdn-us.com', 'tiktokcdn.com', 'tiktokcdn-us.com', 'tiktokcdn-eu.com', 'ibyteimg.com', 'ibytedtos.com', 'byteimg.com'];

function url(value) {
  if (typeof value !== 'string' || value.length > 4096) return null;
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'https:' && !parsed.username && !parsed.password && !parsed.port ? parsed : null;
  } catch { return null; }
}
function productLink(value, productId) {
  const parsed = url(value);
  if (!parsed || !TIKTOK_HOSTS.has(parsed.hostname)) return '';
  const match = parsed.hostname === 'shop.tiktok.com'
    ? parsed.pathname.match(/^\/(?:view\/product\/|(?:us\/)?pdp\/(?:[^/]+\/)?)(\d{5,30})\/?$/)
    : parsed.pathname.match(/^\/shop\/pdp\/(?:[^/]+\/)?(\d{5,30})\/?$/);
  if (!match || match[1] !== productId) return '';
  parsed.search = ''; parsed.hash = '';
  return parsed.href;
}
function sellerLink(value) {
  const parsed = url(value);
  if (!parsed || !TIKTOK_HOSTS.has(parsed.hostname)) return '';
  const valid = parsed.hostname === 'shop.tiktok.com'
    ? /^\/(?:us\/)?store\/(?:[^/]+\/)?\d{5,30}\/?$/.test(parsed.pathname)
    : /^\/shop\/store\/(?:[^/]+\/)?\d{5,30}\/?$/.test(parsed.pathname);
  if (!valid) return '';
  parsed.search = ''; parsed.hash = '';
  return parsed.href;
}
function imageLink(value) {
  const parsed = url(value);
  if (!parsed || !IMAGE_DOMAINS.some(domain => parsed.hostname === domain || parsed.hostname.endsWith(`.${domain}`))) return '';
  parsed.hash = '';
  return parsed.href;
}
function numeric(value, max, integer = false) {
  if (value === null || value === undefined || typeof value === 'boolean' || !['number', 'string'].includes(typeof value) || (typeof value === 'string' && !value.trim())) return null;
  const parsed = typeof value === 'number' ? value : Number(value.trim());
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= max && (!integer || Number.isSafeInteger(parsed)) ? parsed : null;
}
function observationDate(value) {
  const raw = text(value, 64);
  const parsed = Date.parse(raw);
  return raw && Number.isFinite(parsed) && parsed <= Date.now() + 300_000 ? new Date(parsed).toISOString() : null;
}
export function normalizeDiscoveryLead(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const productId = text(input.productId, 40);
  const name = text(input.name);
  if (!PRODUCT_ID.test(productId) || !name || input.market !== 'US' || input.currency !== 'USD' || !['live', 'demo'].includes(input.acquisition)) return null;
  const productUrl = productLink(input.productUrl, productId);
  if (!productUrl) return null;
  const rank = numeric(input.rank, 1_000_000, true);
  return {
    id: `tiktok-${productId}`, productId, name, productUrl, imageUrl: imageLink(input.imageUrl),
    sellerName: text(input.sellerName, 120), sellerUrl: sellerLink(input.sellerUrl),
    listingPrice: numeric(input.listingPrice, MAX_PRICE), currency: 'USD',
    lifetimeSold: numeric(input.lifetimeSold, 1_000_000_000_000, true),
    rating: numeric(input.rating, 5), reviewCount: numeric(input.reviewCount, 1_000_000_000, true),
    rank: rank !== null && rank > 0 ? rank : null, observedAt: observationDate(input.observedAt),
    market: 'US', acquisition: input.acquisition,
  };
}
export function discoveryLeadToProduct(input) {
  const lead = normalizeDiscoveryLead(input);
  if (!lead) throw new Error('This discovery lead is invalid or uses an unsupported market.');
  return {
    id: lead.id, name: lead.name, category: 'TikTok Shop', sourceUrl: lead.productUrl, supplierUrl: '',
    observedAt: lead.observedAt, firstSeenAt: null, lastSeenAt: lead.observedAt,
    sourceType: lead.acquisition === 'demo' ? 'demo' : 'apify', currency: 'USD',
    sellingPrice: lead.listingPrice, unitCost: null, shippingCost: null, feePercent: null, feeFixed: null, refundRate: null,
    activeAds: null, totalAds: null, distinctAdvertisers: null, decision: 'watch',
    tags: ['TikTok listing', 'Needs supplier research'], marketplace: lead,
    notes: [
      lead.acquisition === 'demo' ? 'FICTIONAL DEMO: these marketplace observations are illustrative, not live research.' : 'TikTok Shop marketplace listing observed through Apify; verify the listing before making a decision.',
      'The initial selling price copies the observed marketplace listing price. It is not your own selling price, a supplier quote, or proof of a dropshipping margin. Set your planned price and research costs.',
      'Reported units sold are cumulative lifetime listing sales. This single snapshot does not show 7-day or 30-day sales, growth, revenue, or profit.',
      lead.sellerName && `Marketplace seller: ${lead.sellerName}. This seller has not been verified as a supplier.`,
    ].filter(Boolean).join('\n'),
  };
}
/** Latest available snapshot per product; this keeps no sales history or growth metric. */
export function mergeDiscoveryLeads(existing, incoming) {
  const byId = new Map();
  for (const input of [...(Array.isArray(existing) ? existing : []), ...(Array.isArray(incoming) ? incoming : [])].slice(0, 2000)) {
    const lead = normalizeDiscoveryLead(input);
    if (!lead) continue;
    const previous = byId.get(lead.productId);
    if (!previous || (previous.acquisition === 'demo' && lead.acquisition === 'live') || (previous.acquisition === lead.acquisition && Date.parse(lead.observedAt ?? '') >= Date.parse(previous.observedAt ?? '')) || (previous.acquisition === lead.acquisition && previous.observedAt === null)) byId.set(lead.productId, lead);
  }
  const incomingIds = new Set((Array.isArray(incoming) ? incoming : []).map(value => normalizeDiscoveryLead(value)?.productId).filter(Boolean));
  return [...byId.values()].sort((a, b) => Number(incomingIds.has(b.productId)) - Number(incomingIds.has(a.productId))).slice(0, 100);
}

const HISTORY_KEY = /^tiktok-\d{5,30}$/;
function normalizeObservation(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || !['live', 'demo'].includes(input.acquisition)) return null;
  const observedAt = observationDate(input.observedAt);
  if (!observedAt || Date.parse(observedAt) > Date.now()) return null;
  return { observedAt, lifetimeSold:numeric(input.lifetimeSold, 1_000_000_000_000, true), listingPrice:numeric(input.listingPrice, MAX_PRICE), acquisition:input.acquisition };
}
function observationList(input) {
  const byTime = new Map();
  for (const value of (Array.isArray(input) ? input : []).slice(0, 300)) {
    const point = normalizeObservation(value);
    if (!point) continue;
    const previous = byTime.get(point.observedAt);
    // An explicit demonstration cannot replace an actual provider observation.
    if (!previous || previous.acquisition === point.acquisition || point.acquisition === 'live') byTime.set(point.observedAt, point);
  }
  return [...byTime.values()].sort((a,b) => Date.parse(a.observedAt)-Date.parse(b.observedAt)).slice(-30);
}
/** Validate and bound stored observations without creating any missing historical points. */
export function normalizeDiscoveryHistory(input, prioritizedIds = []) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return {};
  const entries = Object.entries(input).slice(0,1000).flatMap(([key, values]) => {
    if (!HISTORY_KEY.test(key)) return [];
    const points = observationList(values);
    return points.length ? [[key,points]] : [];
  });
  const priorities = new Map((Array.isArray(prioritizedIds) ? prioritizedIds : []).map((key,index) => [key,index]));
  entries.sort((a,b) => (priorities.get(a[0]) ?? 1000) - (priorities.get(b[0]) ?? 1000) || Date.parse(b[1].at(-1).observedAt) - Date.parse(a[1].at(-1).observedAt));
  return Object.fromEntries(entries.slice(0,100));
}
/** Replace the current feed and retain only genuine source-timestamped live snapshots. */
export function recordDiscoverySnapshot(existingFeed, incomingLeads, fetchedAt) {
  const incoming = mergeDiscoveryLeads([], incomingLeads);
  const existing = existingFeed && typeof existingFeed === 'object' ? existingFeed : {};
  const priorLeads = mergeDiscoveryLeads([], existing.leads);
  const history = normalizeDiscoveryHistory(existing.history);
  // Legacy cached leads are themselves genuine observations, not generated backfill.
  for (const lead of [...priorLeads, ...incoming]) {
    if (lead.acquisition !== 'live') continue;
    const point = normalizeObservation(lead);
    if (!point) continue;
    history[lead.id] = observationList([...(history[lead.id] ?? []), point]);
  }
  const updatedAt = observationDate(fetchedAt);
  return { leads:incoming, updatedAt:updatedAt && Date.parse(updatedAt) <= Date.now() ? updatedAt : null, history:normalizeDiscoveryHistory(history,incoming.map(lead=>lead.id)) };
}
/** Counter change since the earliest retained observation; never a 7/30-day sales estimate. */
export function getDiscoveryTrend(inputLead, history) {
  const lead = normalizeDiscoveryLead(inputLead);
  if (!lead) return { points:[], change:null, changePercent:null, windowHours:null };
  const points = observationList(history).filter(point=>point.acquisition===lead.acquisition);
  const first = points[0], last = points.at(-1);
  const windowHours = points.length >= 2 ? (Date.parse(last.observedAt)-Date.parse(first.observedAt))/3_600_000 : null;
  if (points.length < 2 || first.lifetimeSold === null || last.lifetimeSold === null || windowHours === null || windowHours <= 0) return { points, change:null, changePercent:null, windowHours };
  const known = points.filter(point=>point.lifetimeSold!==null);
  if (known.some((point,index)=>index>0 && point.lifetimeSold < known[index-1].lifetimeSold)) return { points, change:null, changePercent:null, windowHours };
  const change = last.lifetimeSold-first.lifetimeSold;
  return { points, change, changePercent:first.lifetimeSold>0 ? change/first.lifetimeSold*100 : null, windowHours };
}
