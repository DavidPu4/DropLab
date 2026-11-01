import type {Product,Experiment,Criteria} from './domain.js';
import type {DiscoveryFeed} from './discovery.js';
export function parseProductCSV(text:string):{products:Product[];errors:string[]};
export function productsToCSV(products:Product[]):string;
export function validateBackup(input:unknown):{products:Product[];experiments:Experiment[];criteria:Criteria;discovery?:DiscoveryFeed};
