import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeDiscoveryLead, discoveryLeadToProduct, mergeDiscoveryLeads } from '../lib/discovery.js';
import { normalizeProduct, calculateEconomics, scoreProduct } from '../lib/domain.js';
import { validateBackup } from '../lib/importers.js';

const productId = '1732714053565124892';
const makeLead = (overrides={}) => ({
  id:'untrusted-id',productId,name:'Magnetic organizer',productUrl:`https://www.tiktok.com/shop/pdp/magnetic-organizer/${productId}?utm_source=example#details`,
  imageUrl:'https://p16-oec-general-useast5.ttcdn-us.com/tos-useast5-i/organizer.webp',
  sellerName:'Example shop',sellerUrl:'https://www.tiktok.com/shop/store/example-shop/7496322034243111196?tracking=123',
  listingPrice:24.99,currency:'USD',lifetimeSold:1200,rating:4.6,reviewCount:80,rank:3,
  observedAt:'2026-10-01T12:00:00.000Z',market:'US',acquisition:'live',...overrides,
});

test('canonical listing keeps IDs exact, strips tracking links and exposes cumulative metrics only',()=>{
  const lead=normalizeDiscoveryLead(makeLead());
  assert.equal(lead.id,`tiktok-${productId}`);assert.equal(lead.productId,productId);
  assert.equal(lead.productUrl,`https://www.tiktok.com/shop/pdp/magnetic-organizer/${productId}`);
  assert.equal(lead.sellerUrl,'https://www.tiktok.com/shop/store/example-shop/7496322034243111196');
  assert.equal(lead.lifetimeSold,1200);assert.equal(lead.rating,4.6);assert.equal(lead.rank,3);
  for(const invented of ['sales7d','sales30d','revenue','growth','estimatedProfit']) assert.equal(Object.hasOwn(lead,invented),false);
});
test('unknown and invalid metrics remain null rather than zero or guessed conversions',()=>{
  const lead=normalizeDiscoveryLead(makeLead({listingPrice:'',lifetimeSold:'1.2K',rating:8,reviewCount:-1,rank:0,observedAt:null}));
  for(const key of ['listingPrice','lifetimeSold','rating','reviewCount','rank','observedAt']) assert.equal(lead[key],null);
  const zero=normalizeDiscoveryLead(makeLead({listingPrice:0,lifetimeSold:0,rating:0,reviewCount:0}));
  assert.equal(zero.lifetimeSold,0);assert.equal(zero.listingPrice,0);
  assert.equal(normalizeDiscoveryLead(makeLead({observedAt:'2999-01-01T00:00:00Z'})).observedAt,null);
});
test('unsupported currencies, markets, missing identity and imprecise numeric IDs are rejected',()=>{
  for(const patch of [{currency:'GBP'},{currency:undefined},{market:'GB'},{market:undefined},{name:''},{productId:Number(productId)},{productId:'123x'},{acquisition:'imported'}]) assert.equal(normalizeDiscoveryLead(makeLead(patch)),null);
  for(const input of [null,undefined,[],42,'bad']) assert.equal(normalizeDiscoveryLead(input),null);
});
test('only expected TikTok product paths with the matching product ID are accepted',()=>{
  for(const productUrl of [`https://shop.tiktok.com/view/product/${productId}`,`https://shop.tiktok.com/us/pdp/organizer/${productId}`,`https://shop.tiktok.com/pdp/${productId}`,`https://www.tiktok.com/shop/pdp/${productId}`]) assert.ok(normalizeDiscoveryLead(makeLead({productUrl})),productUrl);
  for(const productUrl of [`https://tiktok.com.evil.test/shop/pdp/${productId}`,`https://www.tiktok.com/shop/pdp/1732714053565124893`,`http://www.tiktok.com/shop/pdp/${productId}`,`https://www.tiktok.com:8443/shop/pdp/${productId}`,`https://person:secret@www.tiktok.com/shop/pdp/${productId}`,'https://www.tiktok.com/@shop','https://www.tiktok.com/redirect?target=https://example.com']) assert.equal(normalizeDiscoveryLead(makeLead({productUrl})),null,productUrl);
});
test('untrusted images and seller links disappear while usable listing evidence survives',()=>{
  const lead=normalizeDiscoveryLead(makeLead({imageUrl:'https://tracker.example/pixel.gif',sellerUrl:'https://example.com/supplier'}));
  assert.ok(lead);assert.equal(lead.imageUrl,'');assert.equal(lead.sellerUrl,'');
  assert.equal(normalizeDiscoveryLead(makeLead({imageUrl:'https://ttcdn-us.com.evil.test/1.webp'})).imageUrl,'');
  assert.equal(normalizeDiscoveryLead(makeLead({imageUrl:'http://p16-oec-general-useast5.ttcdn-us.com/1.webp'})).imageUrl,'');
  assert.ok(normalizeDiscoveryLead(makeLead({imageUrl:'https://p16-oec-va.ibyteimg.com/1.webp'})).imageUrl);
});
test('discovery product uses listing price as a labeled assumption and invents no unit costs or ads',()=>{
  const product=discoveryLeadToProduct(normalizeDiscoveryLead(makeLead()));
  assert.equal(product.sourceType,'apify');assert.equal(product.sellingPrice,24.99);assert.equal(product.sourceUrl,product.marketplace.productUrl);
  for(const key of ['unitCost','shippingCost','feePercent','feeFixed','refundRate','activeAds','totalAds','distinctAdvertisers']) assert.equal(product[key],null);
  assert.equal(product.supplierUrl,'');assert.equal(calculateEconomics(product).complete,false);
  assert.equal(scoreProduct(product).confidence,'low');
  assert.match(product.notes,/not your own selling price/);assert.match(product.notes,/cumulative lifetime/);assert.match(product.notes,/does not show 7-day or 30-day/);
  assert.throws(()=>discoveryLeadToProduct(makeLead({currency:'GBP'})),/invalid/);
});
test('demo marketplace metadata cannot be promoted into real product provenance',()=>{
  const demo=discoveryLeadToProduct(normalizeDiscoveryLead(makeLead({acquisition:'demo'})));
  assert.equal(demo.sourceType,'demo');assert.match(demo.notes,/FICTIONAL DEMO/);
  assert.equal(normalizeProduct({...demo,sourceType:'apify'},'apify').sourceType,'demo');
  const malformed=normalizeProduct({...demo,sourceType:'apify',marketplace:{...demo.marketplace,productUrl:'javascript:alert(1)'}},'apify');
  assert.equal(malformed.sourceType,'demo');assert.equal(malformed.marketplace,null);
  const conservativelyLabeled=normalizeProduct({...discoveryLeadToProduct(makeLead()),sourceType:'demo'});
  assert.equal(conservativelyLabeled.marketplace.acquisition,'demo');
});
test('merge deduplicates by product ID, retains newest snapshots, and never fabricates growth',()=>{
  const old=normalizeDiscoveryLead(makeLead({observedAt:'2026-09-01T00:00:00Z',lifetimeSold:1000}));
  const next=normalizeDiscoveryLead(makeLead({lifetimeSold:1200}));
  const merged=mergeDiscoveryLeads([old],[next,next]);
  assert.equal(merged.length,1);assert.equal(merged[0].lifetimeSold,1200);assert.equal(merged[0].observedAt,next.observedAt);
  assert.equal(Object.hasOwn(merged[0],'growth'),false);
  assert.equal(mergeDiscoveryLeads([next],[old])[0].lifetimeSold,1200);
  assert.equal(mergeDiscoveryLeads([next],[{...next,acquisition:'demo',lifetimeSold:99999}])[0].acquisition,'live');
  assert.equal(mergeDiscoveryLeads([], [makeLead({currency:'EUR'})]).length,0);
  const many=Array.from({length:120},(_,index)=>makeLead({productId:String(1732714053565124800n+BigInt(index)),productUrl:`https://shop.tiktok.com/view/product/${1732714053565124800n+BigInt(index)}`}));
  assert.equal(mergeDiscoveryLeads([],many).length,100);
});
test('old version-one backups remain valid and optional discovery feed round-trips safely',()=>{
  const empty=validateBackup({version:1,products:[],experiments:[]});assert.equal(Object.hasOwn(empty,'discovery'),false);
  const lead=normalizeDiscoveryLead(makeLead());const product=discoveryLeadToProduct(lead);
  const result=validateBackup(JSON.parse(JSON.stringify({version:1,products:[product],experiments:[],discovery:{leads:[lead],updatedAt:lead.observedAt}})));
  assert.deepEqual(result.discovery.leads,[lead]);assert.deepEqual(result.products[0].marketplace,lead);assert.equal(result.discovery.updatedAt,lead.observedAt);
  assert.throws(()=>validateBackup({products:[],experiments:[],discovery:{leads:[makeLead({currency:'EUR'})],updatedAt:null}}),/invalid/);
  assert.throws(()=>validateBackup({products:[],experiments:[],discovery:{leads:Array(101).fill(lead)}}),/100 leads/);
  assert.throws(()=>validateBackup({products:[],experiments:[],discovery:[]}),/leads array/);
  assert.equal(validateBackup({products:[],experiments:[],discovery:{leads:[],updatedAt:'2999-01-01'}}).discovery.updatedAt,null);
});
