export const RESEARCH_PROVIDER: Readonly<{ actor: string; setupUrl: string; tokenUrl: string; maxResults: number; maxChargeUsd: number }>;
export class ResearchError extends Error { status: number; code: string; constructor(message: string, status?: number, code?: string); }
export function validateLibraryUrl(value: unknown): string;
export function normalizeResearchAds(rows: unknown, observedAt?: string | null): Record<string, unknown>[];
export function researchAction(input: unknown, options?: { fetchImpl?: typeof fetch }): Promise<{runId:string;status:string;products?:Record<string,unknown>[];maxChargeUsd?:number}>;
