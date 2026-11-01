import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateEconomics, calculateExperiment, scoreProduct, normalizeProduct, normalizeExperiment, normalizeCriteria, safeURL } from '../lib/domain.js';
import { parseProductCSV, productsToCSV, validateBackup } from '../lib/importers.js';
import { DEMO_PRODUCTS, DEMO_EXPERIMENTS } from '../lib/demo.js';

const product = (input={}) => normalizeProduct({id:'p1',name:'Example',sellingPrice:50,unitCost:10,shippingCost:5,feePercent:3,feeFixed:0.5,refundRate:10,...input});
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 0.000001, `${actual} != ${expected}`);

test('economics includes every cost and expected refund loss before advertising', () => {
  const result = calculateEconomics(product());
  assert.equal(result.complete, true);
  close(result.netPerOrder,28); close(result.breakEvenCPA,28);
  close(result.marginPercent,56); close(result.breakEvenROAS,50/28);
});
test('unknown assumptions remain unknown rather than implicitly becoming zero', () => {
  const result = calculateEconomics(product({shippingCost:null,refundRate:null}));
  assert.equal(result.complete,false); assert.equal(result.breakEvenCPA,null);
  assert.deepEqual(result.missing,['shippingCost','refundRate']);
  assert.equal(normalizeProduct({unitCost:' '}).unitCost,null);
  assert.equal(normalizeProduct({unitCost:[]}).unitCost,null);
});
test('negative margin does not produce a misleading positive ROAS threshold', () => {
  const result=calculateEconomics(product({unitCost:60}));
  assert.ok(result.breakEvenCPA < 0); assert.equal(result.breakEvenROAS,null);
  assert.equal(scoreProduct(product({unitCost:60})).recommendation,'Rework economics');
});
test('zero price and nonfinite inputs cannot produce infinite unit metrics', () => {
  assert.equal(calculateEconomics(product({sellingPrice:0})).complete,false);
  assert.equal(calculateEconomics({...product(),feePercent:Infinity}).complete,false);
  assert.equal(calculateEconomics({...product(),refundRate:101}).complete,false);
});
test('normalization rejects invalid numbers and unsafe URLs without inventing observations', () => {
  const result=normalizeProduct({name:'  Safe  ',sourceUrl:'javascript:alert(1)',supplierUrl:'https://user:secret@example.com',activeAds:8,totalAds:4,feePercent:101,unitCost:-2,distinctAdvertisers:2.4});
  assert.equal(result.name,'Safe'); assert.equal(result.sourceUrl,''); assert.equal(result.supplierUrl,'');
  assert.equal(result.activeAds,null); assert.equal(result.feePercent,null); assert.equal(result.unitCost,null);assert.equal(result.distinctAdvertisers,null);
  assert.equal(result.observedAt,null); assert.equal(result.refundRate,null);
  assert.throws(()=>normalizeProduct({currency:'EUR'}),/Only USD/);
  assert.equal(safeURL('https://example.com/path'),'https://example.com/path');
});
test('contradictory independent-advertiser counts are unknown rather than positive evidence', () => {
  const invalid = normalizeProduct({totalAds:2,activeAds:2,distinctAdvertisers:3});
  assert.equal(invalid.activeAds,2); assert.equal(invalid.distinctAdvertisers,null);
  assert.ok(scoreProduct(invalid).gaps.includes('Independent advertiser evidence is missing'));
  assert.equal(normalizeProduct({totalAds:0,distinctAdvertisers:1}).distinctAdvertisers,null);
  assert.equal(normalizeProduct({totalAds:3,distinctAdvertisers:3}).distinctAdvertisers,3);
});
test('absurd numeric values remain unknown and cannot overflow derived economics or test metrics', () => {
  const huge = Number.MAX_VALUE;
  assert.equal(normalizeProduct({sellingPrice:huge}).sellingPrice,null);
  assert.equal(normalizeProduct({activeAds:Number.MAX_SAFE_INTEGER+1}).activeAds,null);
  assert.equal(normalizeExperiment({spend:huge,orders:huge}).spend,null);
  const economics = calculateEconomics({...product(),sellingPrice:huge,unitCost:huge,shippingCost:huge});
  assert.equal(economics.complete,false); assert.equal(economics.netPerOrder,null);
  const metrics = calculateExperiment({spend:huge,orders:huge,revenue:huge,refundAmount:0,clicks:1,sessions:1},product({unitCost:huge}));
  assert.equal(metrics.complete,false);
  for (const key of ['profit','cpc','cpa','roas','conversionRate']) assert.equal(metrics[key],null);
  assert.equal(calculateEconomics(product({sellingPrice:Number.MIN_VALUE})).complete,false);
  assert.equal(calculateExperiment({spend:Number.MIN_VALUE,orders:1,revenue:100,refundAmount:0},product()).roas,null);
});
test('research score rewards observed evidence and explains missing evidence', () => {
  const sparse=scoreProduct(product());
  const observed=scoreProduct(product({activeAds:12,totalAds:15,distinctAdvertisers:3,observedAt:new Date().toISOString(),sourceUrl:'https://example.com',supplierUrl:'https://supplier.example.com'}));
  assert.ok(observed.score>sparse.score); assert.equal(observed.confidence,'high');
  assert.equal(sparse.confidence,'low'); assert.ok(sparse.gaps.includes('Active-ad count is unknown'));
  assert.ok(observed.score<=100); assert.ok(observed.reasons.some(reason=>reason.includes('12 observed active ads')));
});
test('criteria changes actually change ranking and invalid settings are constrained', () => {
  const p=product({activeAds:3,totalAds:6});
  assert.ok(scoreProduct(p,{minMarginPercent:80,minActiveAds:10}).score < scoreProduct(p,{minMarginPercent:40,minActiveAds:3}).score);
  assert.deepEqual(normalizeCriteria({minMarginPercent:200,minActiveAds:0,minTestOrders:-3}),{minMarginPercent:100,minActiveAds:1,minTestOrders:5});
});
test('experiment uses actual revenue and refunds without applying estimated refund rate twice', () => {
  const e=normalizeExperiment({productId:'p1',spend:100,orders:10,revenue:500,refundAmount:20,clicks:200,sessions:180});
  const m=calculateExperiment(e,product());
  assert.equal(m.complete,true); close(m.profit,210); close(m.cpc,0.5); close(m.cpa,10); close(m.roas,5);
  close(m.conversionRate,10/180*100); assert.equal(m.verdict,'Profitable recorded test');
});
test('zero-conversion experiments and small samples do not claim a winner', () => {
  const result=calculateExperiment(normalizeExperiment({spend:20,orders:0,revenue:0,refundAmount:0,clicks:0,sessions:0}),product());
  assert.equal(result.cpa,null); assert.equal(result.cpc,null); assert.equal(result.conversionRate,null); assert.equal(result.profit,-20);
  assert.match(result.verdict,/Small sample/);
  assert.equal(calculateExperiment({spend:0,orders:1,revenue:50,refundAmount:0},product()).roas,null);
  assert.equal(calculateExperiment({spend:10,orders:1,revenue:50,refundAmount:null},product()).verdict,'Incomplete results');
});
test('CSV parses BOM, commas, escaped quotes and multiline descriptions', () => {
  const csv='\uFEFFname,price,cost,shipping,feePercent,feeFixed,refundRate,notes\r\n"Desk, organizer",50,10,5,3,0.5,10,"Works on \"\"small\"\" desks\nSample"';
  const parsed=parseProductCSV(csv);
  assert.deepEqual(parsed.errors,[]); assert.equal(parsed.products.length,1);
  assert.equal(parsed.products[0].name,'Desk, organizer'); assert.match(parsed.products[0].notes,/"small" desks\nSample/);
  assert.equal(parsed.products[0].sourceType,'csv'); assert.equal(calculateEconomics(parsed.products[0]).netPerOrder,28);
});
test('CSV reports malformed rows and invalid values while preserving valid rows', () => {
  const parsed=parseProductCSV('name,sellingPrice,unitCost,currency\nGood,30,nope,USD\nWrong,20,2,EUR\nShort,22');
  assert.equal(parsed.products.length,1); assert.equal(parsed.products[0].unitCost,null); assert.equal(parsed.errors.length,3);
  assert.match(parseProductCSV('name,price\n"Broken,3').errors[0],/closing quote/);
  assert.match(parseProductCSV('name,productName\nOne,Two').errors[0],/only once/);
  assert.match(parseProductCSV('price\n3').errors[0],/column is required/);
});
test('CSV exports escape formulas and round-trip ordinary product data', () => {
  const p=product({name:'=HYPERLINK("bad")',notes:'  +SUM(1,2)'});
  const output=productsToCSV([p]);
  assert.ok(output.includes("\"'=HYPERLINK(\"\"bad\"\")\"")); assert.ok(output.includes("'+SUM"));
  const ordinary=product({name:'Desk, tray'});
  const parsed=parseProductCSV(productsToCSV([ordinary]));
  assert.equal(parsed.products[0].name,ordinary.name); assert.equal(parsed.products[0].sellingPrice,50);
});
test('CSV round trips retain fictional provenance and cannot claim a live provider source', () => {
  const exported = productsToCSV(DEMO_PRODUCTS);
  const imported = parseProductCSV(exported);
  assert.equal(imported.products.length,8); assert.deepEqual(imported.errors,[]);
  assert.ok(imported.products.every(p=>p.sourceType==='demo'));
  const claimed = parseProductCSV('name,sourceType\nResearch lead,apify\nInvented sample,demo\nManual import,manual');
  assert.deepEqual(claimed.products.map(p=>p.sourceType),['csv','demo','csv']);
});
test('backup restoration validates relationships and retains real/demo provenance', () => {
  const backup=validateBackup({version:1,products:DEMO_PRODUCTS,experiments:DEMO_EXPERIMENTS,criteria:{minMarginPercent:55}});
  assert.equal(backup.products.length,8); assert.equal(backup.criteria.minMarginPercent,55); assert.ok(backup.products.every(p=>p.sourceType==='demo'));
  assert.throws(()=>validateBackup({products:[product(),product()],experiments:[]}),/duplicate product/);
  assert.throws(()=>validateBackup({products:[product()],experiments:[{productId:'missing'}]}),/missing product/);
  assert.throws(()=>validateBackup({version:99,products:[],experiments:[]}),/version/);
});
