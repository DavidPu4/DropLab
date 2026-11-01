import { discoveryAction, DiscoveryError } from '@/lib/tiktok-provider.js';

const headers = { 'Cache-Control': 'no-store', 'Content-Type': 'application/json', 'X-Content-Type-Options': 'nosniff' };
const MAX_REQUEST_BYTES = 16_384;

export async function POST(request: Request) {
  try {
    const origin = request.headers.get('origin');
    if (origin && origin !== new URL(request.url).origin) {
      return Response.json({ error: 'Discovery requests must come from this app.', code: 'origin_mismatch' }, { status: 403, headers });
    }
    if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) {
      return Response.json({ error: 'Use a JSON request.', code: 'invalid_content_type' }, { status: 415, headers });
    }
    if (Number(request.headers.get('content-length')) > MAX_REQUEST_BYTES) {
      return Response.json({ error: 'Request is too large.', code: 'request_too_large' }, { status: 413, headers });
    }
    const reader = request.body?.getReader();
    if (!reader) throw new DiscoveryError('Expected a JSON request.');
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_REQUEST_BYTES) { await reader.cancel(); throw new DiscoveryError('Request is too large.', 413, 'request_too_large'); }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    let input;
    try { input = JSON.parse(new TextDecoder().decode(bytes)); } catch { throw new DiscoveryError('The request contains invalid JSON.'); }
    return Response.json(await discoveryAction(input), { headers });
  } catch (error) {
    if (error instanceof DiscoveryError) return Response.json({ error: error.message, code: error.code }, { status: error.status, headers });
    return Response.json({ error: 'Discovery could not complete. Check this run in your Apify console.', code: 'discovery_failed' }, { status: 500, headers });
  }
}
