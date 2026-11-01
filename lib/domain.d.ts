import type { DiscoveryLead } from './discovery.js';
export type SourceType = 'demo' | 'manual' | 'csv' | 'apify';
export interface Product { id:string; name:string; category:string; sourceUrl:string; supplierUrl:string; observedAt:string|null; firstSeenAt:string|null; lastSeenAt:string|null; sourceType:SourceType; currency:'USD'; sellingPrice:number|null; unitCost:number|null; shippingCost:number|null; feePercent:number|null; feeFixed:number|null; refundRate:number|null; activeAds:number|null; totalAds:number|null; distinctAdvertisers:number|null; notes:string; decision:'watch'|'test'|'pass'; tags:string[]; marketplace?:DiscoveryLead|null; }
export interface Criteria { minMarginPercent:number; minActiveAds:number; minTestOrders:number; }
export interface Experiment { id:string; productId:string; label:string; spend:number|null; clicks:number|null; sessions:number|null; addToCarts:number|null; orders:number|null; revenue:number|null; refundAmount:number|null; creativeHook:string; runDate:string|null; sourceType:'demo'|'manual'; }
export const DEFAULT_CRITERIA: Readonly<Criteria>;
export const PRODUCT_NUMBERS: string[];
export function safeURL(value:unknown):string;
export function normalizeCriteria(input?:Partial<Criteria>):Criteria;
export function normalizeProduct(input?:Partial<Product>|Record<string,unknown>,sourceType?:SourceType):Product;
export function normalizeExperiment(input?:Partial<Experiment>|Record<string,unknown>):Experiment;
export function calculateEconomics(product:Partial<Product>):{complete:boolean;breakEvenCPA:number|null;breakEvenROAS:number|null;marginPercent:number|null;netPerOrder:number|null;missing:string[]};
export function scoreProduct(product:Product,criteria?:Partial<Criteria>):{score:number;confidence:'low'|'medium'|'high';reasons:string[];gaps:string[];recommendation:string};
export function calculateExperiment(experiment:Partial<Experiment>,product?:Partial<Product>,criteria?:Partial<Criteria>):{complete:boolean;cpc:number|null;cpa:number|null;roas:number|null;profit:number|null;conversionRate:number|null;verdict:string};
