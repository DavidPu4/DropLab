import { normalizeDiscoveryLead } from './discovery.js';
/** DropLab's transparent research rules. Scores rank research, never predict success. */
export const DEFAULT_CRITERIA = Object.freeze({ minMarginPercent: 40, minActiveAds: 3, minTestOrders: 5 });
export const PRODUCT_NUMBERS = ['sellingPrice', 'unitCost', 'shippingCost', 'feePercent', 'feeFixed', 'refundRate', 'activeAds', 'totalAds', 'distinctAdvertisers'];
const MAX_INPUT_NUMBER = 1_000_000_000;
const counts = new Set(['activeAds', 'totalAds', 'distinctAdvertisers']);
const text = (value, max = 3000) => typeof value === 'string' ? value.trim().slice(0, max) : '';
const id = () => globalThis.crypto?.randomUUID?.() ?? `item-${Date.now()}-${Math.random().toString(36).slice(2)}`;
const finite = value => typeof value === 'number' && Number.isFinite(value);
function number(value, integer = false) {
  if (value === null || value === undefined || value === '' || typeof value === 'boolean') return null;
  if (!['string', 'number'].includes(typeof value) || (typeof value === 'string' && !value.trim())) return null;
  const parsed = typeof value === 'number' ? value : Number(String(value).trim());
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= MAX_INPUT_NUMBER && (!integer || Number.isSafeInteger(parsed)) ? parsed : null;
}
export function safeURL(value) {
  try {
    const url = new URL(text(value, 2048));
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password ? url.href : '';
  } catch { return ''; }
}
const date = value => {
  const raw = text(value, 64);
  return raw && Number.isFinite(Date.parse(raw)) ? new Date(raw).toISOString() : null;
};
export function normalizeCriteria(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) input = {};
  return {
    minMarginPercent: Math.min(100, number(input.minMarginPercent) ?? DEFAULT_CRITERIA.minMarginPercent),
    minActiveAds: Math.max(1, number(input.minActiveAds, true) ?? DEFAULT_CRITERIA.minActiveAds),
    minTestOrders: Math.max(1, number(input.minTestOrders, true) ?? DEFAULT_CRITERIA.minTestOrders),
  };
}
export function normalizeProduct(input = {}, sourceType) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('A product must be an object.');
  if (input.currency && String(input.currency).toUpperCase() !== 'USD') throw new Error('Only USD is supported. Convert prices before importing.');
  const product = {
    id: text(input.id, 160) || id(), name: text(input.name, 160) || 'Untitled product',
    category: text(input.category, 80) || 'Other', sourceUrl: safeURL(input.sourceUrl), supplierUrl: safeURL(input.supplierUrl),
    observedAt: date(input.observedAt), firstSeenAt: date(input.firstSeenAt), lastSeenAt: date(input.lastSeenAt),
    sourceType: ['demo', 'manual', 'csv', 'apify'].includes(sourceType ?? input.sourceType) ? (sourceType ?? input.sourceType) : 'manual',
    currency: 'USD', notes: text(input.notes), decision: ['watch', 'test', 'pass'].includes(input.decision) ? input.decision : 'watch',
    tags: Array.isArray(input.tags) ? [...new Set(input.tags.map(tag => text(tag, 40)).filter(Boolean))].slice(0, 12) : [],
  };
  for (const key of PRODUCT_NUMBERS) product[key] = number(input[key], counts.has(key));
  for (const key of ['feePercent', 'refundRate']) if (product[key] !== null && product[key] > 100) product[key] = null;
  // Contradictory observations are unknown, rather than evidence for a strong score.
  if (product.totalAds !== null && product.activeAds !== null && product.activeAds > product.totalAds) product.activeAds = null;
  if (product.totalAds !== null && product.distinctAdvertisers !== null && product.distinctAdvertisers > product.totalAds) product.distinctAdvertisers = null;
  if (Object.hasOwn(input, 'marketplace')) {
    product.marketplace = normalizeDiscoveryLead(input.marketplace);
    if (input.marketplace?.acquisition === 'demo' || product.marketplace?.acquisition === 'demo') product.sourceType = 'demo';
    if (product.sourceType === 'demo' && product.marketplace?.acquisition === 'live') product.marketplace = { ...product.marketplace, acquisition: 'demo' };
  }
  return product;
}
export function calculateEconomics(product) {
  const keys = ['sellingPrice', 'unitCost', 'shippingCost', 'feePercent', 'feeFixed', 'refundRate'];
  const missing = keys.filter(key => !finite(product?.[key]) || product[key] < 0 || product[key] > MAX_INPUT_NUMBER || (key === 'sellingPrice' && product[key] === 0) || (['feePercent', 'refundRate'].includes(key) && product[key] > 100));
  if (missing.length) return { complete: false, breakEvenCPA: null, breakEvenROAS: null, marginPercent: null, netPerOrder: null, missing };
  const { sellingPrice: price, unitCost, shippingCost, feePercent, feeFixed, refundRate } = product;
  const netPerOrder = price * (1 - refundRate / 100) - unitCost - shippingCost - price * feePercent / 100 - feeFixed;
  const marginPercent = netPerOrder / price * 100;
  const breakEvenROAS = netPerOrder > 0 ? price / netPerOrder : null;
  if (!finite(netPerOrder) || !finite(marginPercent) || (breakEvenROAS !== null && !finite(breakEvenROAS))) return { complete:false, breakEvenCPA:null, breakEvenROAS:null, marginPercent:null, netPerOrder:null, missing:['sellingPrice'] };
  return { complete: true, breakEvenCPA: netPerOrder, breakEvenROAS, marginPercent, netPerOrder, missing: [] };
}
export function scoreProduct(product, inputCriteria = DEFAULT_CRITERIA) {
  const criteria = normalizeCriteria(inputCriteria);
  const economics = calculateEconomics(product);
  const reasons = [], gaps = [];
  let score = 0;
  if (economics.complete) {
    score += Math.max(0, Math.min(35, economics.marginPercent / Math.max(1, criteria.minMarginPercent) * 35));
    if (economics.marginPercent >= criteria.minMarginPercent) reasons.push(`Meets ${criteria.minMarginPercent}% contribution margin target`);
    else gaps.push(economics.netPerOrder <= 0 ? 'Costs exceed revenue before ads' : 'Margin is below your target');
  } else gaps.push('Complete price, cost, fee and refund assumptions');
  if (finite(product.activeAds)) {
    score += Math.min(20, product.activeAds / criteria.minActiveAds * 20);
    if (product.activeAds >= criteria.minActiveAds) reasons.push(`${product.activeAds} observed active ads`);
    else gaps.push('Active-ad count is below your research threshold');
  } else gaps.push('Active-ad count is unknown');
  if (finite(product.distinctAdvertisers)) {
    score += Math.min(15, product.distinctAdvertisers * 5);
    if (product.distinctAdvertisers > 0) reasons.push(`Observed across ${product.distinctAdvertisers} advertiser${product.distinctAdvertisers === 1 ? '' : 's'}`);
  } else gaps.push('Independent advertiser evidence is missing');
  if (finite(product.totalAds) && product.totalAds > 0 && finite(product.activeAds)) score += Math.min(10, product.activeAds / product.totalAds * 10);
  else gaps.push('Ad activity ratio cannot be assessed');
  const observedTime = Date.parse(product.observedAt ?? '');
  const ageDays = (Date.now() - observedTime) / 86400000;
  if (Number.isFinite(ageDays) && ageDays >= -1 && ageDays <= 30) { score += 10; reasons.push('Observation recorded within 30 days'); }
  else gaps.push('Add a recent observation date');
  if (safeURL(product.sourceUrl)) score += 5; else gaps.push('Add a research source link');
  if (safeURL(product.supplierUrl)) score += 5; else gaps.push('Verify a supplier and delivery terms');
  const known = ['sellingPrice', 'unitCost', 'shippingCost', 'feePercent', 'feeFixed', 'refundRate', 'activeAds', 'totalAds', 'distinctAdvertisers'].filter(key => finite(product[key])).length + Number(!!product.sourceUrl) + Number(!!product.supplierUrl) + Number(Number.isFinite(observedTime));
  const confidence = known >= 11 ? 'high' : known >= 7 ? 'medium' : 'low';
  score = Math.round(Math.min(100, Math.max(0, score)));
  const recommendation = economics.complete && economics.netPerOrder <= 0 ? 'Rework economics' : score >= 70 && confidence !== 'low' ? 'Consider a small test' : score >= 40 ? 'Research further' : 'Gather evidence';
  return { score, confidence, reasons, gaps, recommendation };
}
export function normalizeExperiment(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('An experiment must be an object.');
  const experiment = { id: text(input.id, 160) || id(), productId: text(input.productId, 160), label: text(input.label, 160) || 'Product test', creativeHook: text(input.creativeHook, 1000), runDate: date(input.runDate), sourceType: input.sourceType === 'demo' ? 'demo' : 'manual' };
  for (const key of ['spend', 'clicks', 'sessions', 'addToCarts', 'orders', 'revenue', 'refundAmount']) experiment[key] = number(input[key], ['clicks', 'sessions', 'addToCarts', 'orders'].includes(key));
  return experiment;
}
export function calculateExperiment(experiment, product, inputCriteria = DEFAULT_CRITERIA) {
  const criteria = normalizeCriteria(inputCriteria);
  const e = experiment ?? {};
  const valid = key => finite(e[key]) && e[key] >= 0 && e[key] <= MAX_INPUT_NUMBER && (!['clicks', 'sessions', 'addToCarts', 'orders'].includes(key) || Number.isSafeInteger(e[key]));
  // Actual revenue/refunds supersede price/refund estimates; current per-order costs remain assumptions.
  const costsKnown = product && ['unitCost', 'shippingCost', 'feePercent', 'feeFixed'].every(key => finite(product[key]) && product[key] >= 0 && product[key] <= MAX_INPUT_NUMBER) && product.feePercent <= 100;
  const complete = ['spend', 'orders', 'revenue', 'refundAmount'].every(valid) && !!costsKnown;
  const profit = complete ? e.revenue - e.refundAmount - e.spend - e.orders * (product.unitCost + product.shippingCost + product.feeFixed) - e.revenue * product.feePercent / 100 : null;
  const ratio = (numerator, denominator) => valid(numerator) && valid(denominator) && e[denominator] > 0 && finite(e[numerator] / e[denominator]) ? e[numerator] / e[denominator] : null;
  const cpc = ratio('spend','clicks');
  const cpa = ratio('spend','orders');
  const roas = ratio('revenue','spend');
  const conversionRate = valid('orders') && valid('sessions') && e.sessions > 0 ? e.orders / e.sessions * 100 : null;
  const verdict = !complete ? 'Incomplete results' : e.orders < criteria.minTestOrders ? 'Small sample — keep learning' : profit > 0 ? 'Profitable recorded test' : 'Unprofitable recorded test';
  return { complete, cpc, cpa, roas, profit, conversionRate, verdict };
}
