'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');

const APP_ORIGIN = 'droplab://app';
const MAX_BODY_BYTES = 16_384;
const IMAGE_HOSTS = [
  'https://*.ttcdn-us.com', 'https://*.tiktokcdn.com', 'https://*.tiktokcdn-us.com',
  'https://*.tiktokcdn-eu.com', 'https://*.ibyteimg.com', 'https://*.ibytedtos.com', 'https://*.byteimg.com',
];
const CSP = [
  "default-src 'self'", "script-src 'self'", "style-src 'self' 'unsafe-inline'",
  `img-src 'self' data: blob: ${IMAGE_HOSTS.join(' ')}`,
  "font-src 'self'", "connect-src 'self'", "object-src 'none'", "frame-src 'none'",
  "base-uri 'self'", "form-action 'self'", "frame-ancestors 'none'",
].join('; ');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8',
};

function isAppURL(value) {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'droplab:' && parsed.hostname === 'app' &&
      !parsed.username && !parsed.password && !parsed.port;
  } catch { return false; }
}

function isAppOrigin(value) {
  if (!isAppURL(value)) return false;
  const parsed = new URL(value);
  return (!parsed.pathname || parsed.pathname === '/') && !parsed.search && !parsed.hash;
}

function isAllowedExternalURL(value) {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'https:' && !parsed.username && !parsed.password &&
      parsed.href.length <= 4096 && !parsed.port && !!parsed.hostname;
  } catch { return false; }
}

function requestIsTrusted(request, requireInitiator = false) {
  const initiator = request.initiatorOrigin;
  const origin = request.headers.get('origin');
  const referrer = request.referrer;
  if (initiator && !isAppOrigin(initiator)) return false;
  if (origin && !isAppOrigin(origin)) return false;
  if (referrer && referrer !== 'about:client' && !isAppURL(referrer)) return false;
  return !requireInitiator || isAppOrigin(initiator) || isAppOrigin(origin);
}

function resolveAssetPath(rendererRoot, pathname) {
  let decoded;
  try { decoded = decodeURIComponent(pathname); } catch { return null; }
  if (!decoded.startsWith('/') || decoded.includes('\0') || decoded.includes('\\')) return null;
  const relative = decoded === '/' ? 'index.html' : decoded.slice(1);
  const root = path.resolve(rendererRoot);
  const target = path.resolve(root, relative);
  const withinRoot = path.relative(root, target);
  if (!withinRoot || withinRoot.startsWith('..') || path.isAbsolute(withinRoot)) return null;
  return MIME_TYPES[path.extname(target).toLowerCase()] ? target : null;
}

function json(value, status = 200) {
  return Response.json(value, { status, headers: {
    'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
    'Access-Control-Allow-Origin': APP_ORIGIN, 'Vary': 'Origin',
  } });
}

async function readJSON(request) {
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) {
    return { response: json({ error: 'Use a JSON request.', code: 'invalid_content_type' }, 415) };
  }
  if (Number(request.headers.get('content-length')) > MAX_BODY_BYTES) {
    return { response: json({ error: 'Request is too large.', code: 'request_too_large' }, 413) };
  }
  const reader = request.body?.getReader();
  if (!reader) return { response: json({ error: 'Expected a JSON request.', code: 'invalid_request' }, 400) };
  const chunks = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BODY_BYTES) {
      await reader.cancel();
      return { response: json({ error: 'Request is too large.', code: 'request_too_large' }, 413) };
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try { return { input: JSON.parse(new TextDecoder().decode(bytes)) }; }
  catch { return { response: json({ error: 'The request contains invalid JSON.', code: 'invalid_request' }, 400) }; }
}

function createProtocolHandler({ rendererRoot, discoveryAction, researchAction, version = '0.2.0' }) {
  return async function handleAppRequest(request) {
    if (!isAppURL(request.url) || !requestIsTrusted(request)) {
      return json({ error: 'This resource belongs to DropLab.', code: 'origin_mismatch' }, 403);
    }
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/')) {
      if (!requestIsTrusted(request, true)) return json({ error: 'Requests must come from DropLab.', code: 'origin_mismatch' }, 403);
      if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: {
        'Access-Control-Allow-Origin': APP_ORIGIN, 'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type', 'Vary': 'Origin',
      } });
      if (url.pathname === '/api/desktop' && request.method === 'GET') return json({ desktop: true, version });
      const action = url.pathname === '/api/discovery' ? discoveryAction : url.pathname === '/api/research' ? researchAction : null;
      if (!action) return json({ error: 'Unknown endpoint.', code: 'not_found' }, 404);
      if (request.method !== 'POST') return json({ error: 'Use POST for this endpoint.', code: 'method_not_allowed' }, 405);
      try {
        const parsed = await readJSON(request);
        if (parsed.response) return parsed.response;
        return json(await action(parsed.input));
      } catch (error) {
        if (['DiscoveryError', 'ResearchError'].includes(error?.name) && Number.isInteger(error.status) && error.status >= 400 && error.status <= 599) {
          return json({ error: error.message, code: error.code }, error.status);
        }
        // Provider modules supply their own sanitized errors. Never return raw exception details.
        return json({ error: 'The request could not complete. Your saved workspace has been kept.', code: 'request_failed' }, 500);
      }
    }
    if (!['GET', 'HEAD'].includes(request.method)) return new Response('Method not allowed', { status: 405 });
    const asset = resolveAssetPath(rendererRoot, url.pathname);
    if (!asset) return new Response('Not found', { status: 404 });
    try {
      const data = await fs.readFile(asset);
      return new Response(request.method === 'HEAD' ? null : data, { headers: {
        'Content-Type': MIME_TYPES[path.extname(asset).toLowerCase()],
        'Content-Security-Policy': CSP, 'X-Content-Type-Options': 'nosniff',
        'Cache-Control': path.extname(asset) === '.html' ? 'no-store' : 'public, max-age=31536000, immutable',
      } });
    } catch { return new Response('Not found', { status: 404 }); }
  };
}

module.exports = { APP_ORIGIN, CSP, MAX_BODY_BYTES, createProtocolHandler, isAppURL, isAppOrigin, isAllowedExternalURL, resolveAssetPath };
