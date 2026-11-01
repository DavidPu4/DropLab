import { normalizeProduct, normalizeExperiment } from './domain.js';

// Illustrative observations and prices only. No sample product is a market recommendation.
const now = new Date().toISOString();
const base = { sourceType: 'demo', observedAt: now, sourceUrl: 'https://www.facebook.com/ads/library/', supplierUrl: 'https://www.aliexpress.com/', feePercent: 2.9, feeFixed: 0.3, refundRate: 5, decision: 'watch' };
export const DEMO_PRODUCTS = [
  { id:'demo-travel',name:'Magnetic travel organizer',category:'Travel',sellingPrice:34.99,unitCost:8.2,shippingCost:3.5,activeAds:14,totalAds:19,distinctAdvertisers:4,tags:['Problem solver','Giftable'],notes:'Sample only. Validate magnet strength, dimensions and delivery times before testing.' },
  { id:'demo-pet',name:'Pet hair remover roller',category:'Pets',sellingPrice:29.99,unitCost:5.8,shippingCost:3.2,activeAds:9,totalAds:15,distinctAdvertisers:3,tags:['Demonstrable','Evergreen'],notes:'Sample only. Test performance on multiple fabrics and compare competitors.' },
  { id:'demo-desk',name:'Fold-flat laptop stand',category:'Tech & desk',sellingPrice:39.99,unitCost:12.5,shippingCost:4.8,activeAds:6,totalAds:12,distinctAdvertisers:2,tags:['Desk setup'],notes:'Sample only. Crowded category; verify stability and a distinctive creative angle.' },
  { id:'demo-kitchen',name:'Adjustable drawer dividers',category:'Home',sellingPrice:32.99,unitCost:9.4,shippingCost:5.2,activeAds:4,totalAds:10,distinctAdvertisers:2,tags:['Before & after'],notes:'Sample only. Supplier listing dimensions and shipping estimates need verification.' },
  { id:'demo-fitness',name:'Portable resistance trainer',category:'Fitness',sellingPrice:49.99,unitCost:16.2,shippingCost:5.5,activeAds:2,totalAds:9,distinctAdvertisers:1,tags:['Demonstrable'],notes:'Sample only. Verify product safety; avoid unsubstantiated health claims.' },
  { id:'demo-light',name:'Rechargeable reading light',category:'Home',sellingPrice:24.99,unitCost:7.5,shippingCost:4.1,activeAds:3,totalAds:17,distinctAdvertisers:2,tags:['Giftable'],notes:'Sample only. Battery shipping constraints and returns may affect margin.' },
  { id:'demo-beauty',name:'Heatless curling ribbon',category:'Beauty',sellingPrice:19.99,unitCost:3.8,shippingCost:3.4,activeAds:null,totalAds:null,distinctAdvertisers:null,sourceUrl:'',tags:['Missing evidence'],notes:'Sample only. Pricing inputs exist but advertising evidence is unknown.' },
  { id:'demo-bottle',name:'Insulated everyday bottle',category:'Outdoors',sellingPrice:22.99,unitCost:13.9,shippingCost:7.2,activeAds:1,totalAds:8,distinctAdvertisers:1,refundRate:8,tags:['Low margin'],notes:'Sample only. Heavy shipping and refund allowance leave no room for paid acquisition.' },
].map(product => normalizeProduct({...base,...product}, 'demo'));

export const DEMO_EXPERIMENTS = [
  {id:'demo-test-pet',productId:'demo-pet',label:'Fabric cleanup demonstration',creativeHook:'One pass across the couch',spend:85,clicks:160,sessions:142,addToCarts:17,orders:8,revenue:239.92,refundAmount:0,runDate:now,sourceType:'demo'},
  {id:'demo-test-desk',productId:'demo-desk',label:'Small desk setup angle',creativeHook:'A little more room to work',spend:90,clicks:112,sessions:101,addToCarts:8,orders:3,revenue:119.97,refundAmount:0,runDate:now,sourceType:'demo'},
].map(normalizeExperiment);
