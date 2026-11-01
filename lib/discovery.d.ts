import type { Product } from './domain.js';
export interface DiscoveryLead { id:string; productId:string; name:string; productUrl:string; imageUrl:string; sellerName:string; sellerUrl:string; listingPrice:number|null; currency:'USD'; lifetimeSold:number|null; rating:number|null; reviewCount:number|null; rank:number|null; observedAt:string|null; market:'US'; acquisition:'live'|'demo'; }
export interface DiscoveryFeed { leads:DiscoveryLead[]; updatedAt:string|null; }
export function normalizeDiscoveryLead(input:unknown):DiscoveryLead|null;
export function discoveryLeadToProduct(input:DiscoveryLead):Product;
export function mergeDiscoveryLeads(existing:DiscoveryLead[],incoming:DiscoveryLead[]):DiscoveryLead[];
