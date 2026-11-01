import type { DiscoveryLead } from './discovery.js';
export const DISCOVERY_PROVIDER: Readonly<{ actor: string; actorId: string; setupUrl: string; tokenUrl: string; experimental: boolean; market: string; defaultResults: number; maxResults: number; maxChargeUsd: number }>;
export class DiscoveryError extends Error { status: number; code: string; constructor(message: string, status?: number, code?: string); }
export function normalizeTikTokRows(rows: unknown, runObservedAt?: string | null): DiscoveryLead[];
export function discoveryAction(input: unknown, options?: { fetchImpl?: typeof fetch }): Promise<{ runId: string; status: string; maxChargeUsd?: number; leads?: DiscoveryLead[]; warning?: string }>;
