import { normalizeProduct, normalizeExperiment, normalizeCriteria, PRODUCT_NUMBERS } from './domain.js';
import { normalizeDiscoveryLead, mergeDiscoveryLeads, normalizeDiscoveryHistory } from './discovery.js';

const COLUMNS = ['name', 'category', 'sourceUrl', 'supplierUrl', 'sellingPrice', 'unitCost', 'shippingCost', 'feePercent', 'feeFixed', 'refundRate', 'activeAds', 'totalAds', 'distinctAdvertisers', 'observedAt', 'firstSeenAt', 'lastSeenAt', 'decision', 'currency', 'sourceType', 'notes'];
const headerKey = value => value.trim().toLowerCase().replace(/[\s_-]+/g, '');
const aliases = Object.fromEntries(COLUMNS.map(key => [headerKey(key), key]));
Object.assign(aliases, { product: 'name', productname: 'name', title: 'name', price: 'sellingPrice', cost: 'unitCost', shipping: 'shippingCost', source: 'sourceUrl', supplier: 'supplierUrl', status: 'decision' });

function rowsFromCSV(text) {
  const rows = []; let row = [], cell = '', quoted = false, justClosed = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') { quoted = false; justClosed = true; }
      else cell += ch;
      continue;
    }
    if (ch === '"') {
      if (cell.trim() || justClosed) throw new Error('Unexpected quote in CSV. Put quoted fields inside double quotes.');
      quoted = true; cell = '';
    } else if (ch === ',') { row.push(cell); cell = ''; justClosed = false; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); if (row.some(value => value.trim())) rows.push(row);
      row = []; cell = ''; justClosed = false;
    } else if (justClosed) {
      if (ch !== ' ' && ch !== '\t') throw new Error('Unexpected text after a quoted CSV field.');
    } else cell += ch;
  }
  if (quoted) throw new Error('A quoted CSV field is missing its closing quote.');
  row.push(cell); if (row.some(value => value.trim())) rows.push(row);
  return rows;
}
export function parseProductCSV(input) {
  const errors = [], products = [];
  if (typeof input !== 'string' || input.length > 5_000_000) return { products, errors: ['CSV must be text smaller than 5 MB.'] };
  let rows;
  try { rows = rowsFromCSV(input.replace(/^\uFEFF/, '')); } catch (error) { return { products, errors: [error.message] }; }
  if (rows.length < 2) return { products, errors: ['Include a header row and at least one product.'] };
  const headers = rows[0].map(value => aliases[headerKey(value)] ?? '');
  if (!headers.includes('name')) return { products, errors: ['A name (or productName) column is required.'] };
  const namedHeaders = headers.filter(Boolean);
  if (new Set(namedHeaders).size !== namedHeaders.length) return { products, errors: ['Each recognized CSV column must appear only once.'] };
  if (rows.length > 2001) return { products, errors: ['Import at most 2,000 products at a time.'] };
  for (let i = 1; i < rows.length; i++) {
    const cells = rows[i];
    if (cells.length !== headers.length) { errors.push(`Row ${i + 1}: expected ${headers.length} columns, received ${cells.length}.`); continue; }
    const record = {};
    headers.forEach((key, col) => { if (key) record[key] = cells[col].trim(); });
    if (!record.name) { errors.push(`Row ${i + 1}: product name is empty.`); continue; }
    for (const key of PRODUCT_NUMBERS) {
      if (record[key] === undefined || record[key] === '') continue;
      const raw = record[key];
      const value = Number(raw.replace(/^\$/, '').replaceAll(',', '').replace(/%$/, ''));
      if (!Number.isFinite(value) || value < 0 || value > 1_000_000_000 || (['activeAds', 'totalAds', 'distinctAdvertisers'].includes(key) && !Number.isSafeInteger(value)) || (['feePercent', 'refundRate'].includes(key) && value > 100)) {
        errors.push(`Row ${i + 1}: ${key} is invalid and was left unknown.`); record[key] = null;
      } else record[key] = value;
    }
    if (record.activeAds !== undefined && record.activeAds !== null && record.totalAds !== undefined && record.totalAds !== null && record.activeAds > record.totalAds) errors.push(`Row ${i + 1}: activeAds exceeds totalAds; active count was left unknown.`);
    if (record.distinctAdvertisers !== undefined && record.distinctAdvertisers !== null && record.totalAds !== undefined && record.totalAds !== null && record.distinctAdvertisers > record.totalAds) errors.push(`Row ${i + 1}: distinctAdvertisers exceeds totalAds; advertiser count was left unknown.`);
    // Preserve fictional provenance in our own exports. CSV cannot claim provider verification.
    try { products.push(normalizeProduct(record, record.sourceType === 'demo' ? 'demo' : 'csv')); } catch (error) { errors.push(`Row ${i + 1}: ${error.message}`); }
  }
  return { products, errors };
}
function csvCell(value) {
  let text = value === null || value === undefined ? '' : String(value);
  // Prevent spreadsheet formulas from executing when an exported file is opened.
  if (/^[\s]*[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}
export function productsToCSV(products) {
  return [COLUMNS.map(csvCell).join(','), ...products.map(product => COLUMNS.map(key => csvCell(product[key])).join(','))].join('\r\n');
}
export function validateBackup(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Backup must be a JSON object.');
  if (input.version !== undefined && input.version !== 1) throw new Error('This backup version is not supported.');
  if (!Array.isArray(input.products) || !Array.isArray(input.experiments)) throw new Error('Backup must include products and experiments arrays.');
  if (input.products.length > 2000 || input.experiments.length > 10000) throw new Error('Backup exceeds the supported workspace size.');
  const products = input.products.map(value => normalizeProduct(value));
  const experiments = input.experiments.map(value => normalizeExperiment(value));
  const productIds = new Set(products.map(value => value.id));
  if (productIds.size !== products.length) throw new Error('Backup contains duplicate product IDs.');
  if (new Set(experiments.map(value => value.id)).size !== experiments.length) throw new Error('Backup contains duplicate experiment IDs.');
  if (experiments.some(value => !productIds.has(value.productId))) throw new Error('A test refers to a missing product.');
  const result = { products, experiments, criteria: normalizeCriteria(input.criteria) };
  if (input.discovery !== undefined) {
    if (!input.discovery || typeof input.discovery !== 'object' || Array.isArray(input.discovery) || !Array.isArray(input.discovery.leads)) throw new Error('Backup discovery feed must include a leads array.');
    if (input.discovery.leads.length > 100) throw new Error('Backup discovery feed exceeds 100 leads.');
    const leads = input.discovery.leads.map(normalizeDiscoveryLead);
    if (leads.some(lead => lead === null)) throw new Error('Backup discovery feed contains an invalid or unsupported listing.');
    const updated = typeof input.discovery.updatedAt === 'string' ? Date.parse(input.discovery.updatedAt) : NaN;
    result.discovery = { leads:mergeDiscoveryLeads([],leads), updatedAt:Number.isFinite(updated) && updated <= Date.now() + 300_000 ? new Date(updated).toISOString() : null };
    if (input.discovery.history !== undefined) {
      const history = input.discovery.history;
      if (!history || typeof history !== 'object' || Array.isArray(history)) throw new Error('Backup discovery history must be an object.');
      const entries = Object.entries(history);
      if (entries.length > 100) throw new Error('Backup discovery history exceeds 100 products.');
      if (entries.some(([key, points]) => !/^tiktok-\d{5,30}$/.test(key) || !Array.isArray(points) || points.length > 30)) throw new Error('Backup discovery history contains an invalid product key or more than 30 observations.');
      // Sanitize optional historical points while retaining the rest of a valid legacy workspace.
      result.discovery.history = normalizeDiscoveryHistory(history, leads.map(lead=>lead.id));
    }
  }
  return result;
}
