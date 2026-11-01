import type { Product } from './domain.js';
export interface DiscoveryLead { id:string; productId:string; name:string; productUrl:string; imageUrl:string; sellerName:string; sellerUrl:string; listingPrice:number|null; currency:'USD'; lifetimeSold:number|null; rating:number|null; reviewCount:number|null; rank:number|null; observedAt:string|null; market:'US'; acquisition:'live'|'demo'; }
export interface DiscoveryObservation { observedAt:string; lifetimeSold:number|null; listingPrice:number|null; acquisition:'live'|'demo'; }
export interface DiscoveryTrend { points:DiscoveryObservation[]; change:number|null; changePercent:number|null; windowHours:number|null; }
export interface DiscoveryFeed { leads:DiscoveryLead[]; updatedAt:string|null; history?:Record<string,DiscoveryObservation[]>; }
export function normalizeDiscoveryLead(input:unknown):DiscoveryLead|null;
export function discoveryLeadToProduct(input:DiscoveryLead):Product;
export function mergeDiscoveryLeads(existing:DiscoveryLead[],incoming:DiscoveryLead[]):DiscoveryLead[];
export function normalizeDiscoveryHistory(input:unknown,prioritizedIds?:string[]):Record<string,DiscoveryObservation[]>;
export function recordDiscoverySnapshot(existingFeed:DiscoveryFeed|undefined,incomingLeads:DiscoveryLead[],fetchedAt:string|null):DiscoveryFeed;
export function getDiscoveryTrend(lead:DiscoveryLead,history?:DiscoveryObservation[]):DiscoveryTrend;
