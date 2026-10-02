// The whole backend: static files and a health check. There is deliberately no upload
// route — documents are read in the visitor's browser and never reach this process.

import { createReadStream, statSync, type Stats } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { clientIp, TokenBuckets } from './limits.js';

/** Served at the root of ocr.repo.lv. Set a prefix (with trailing slash) to mount it under a path. */
export const BASE: string = '/';
const PORT = Number(process.env.PORT ?? 3101);
const HOST = process.env.HOST ?? '0.0.0.0';
const DIST = resolve(process.env.DIST_DIR ?? join(fileURLToPath(new URL('.', import.meta.url)), '..', '..', 'dist'));

// A cold page load is ~25 requests (html, js, css, fonts, thumbnails); OCR adds three
// large files. 240 burst / 4 per second never touches a person and still stops a loop.
const perIp = new TokenBuckets(240, 4);
const MAX_IN_FLIGHT = 128;
let inFlight = 0;

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
  '.wasm': 'application/wasm',
  '.pdf': 'application/pdf',
  // tesseract gunzips the language models itself: serve them as opaque bytes, never with
  // Content-Encoding, or the browser would unzip them first and tesseract would choke.
  '.gz': 'application/octet-stream',
  '.pfb': 'application/octet-stream',
  '.bcmap': 'application/octet-stream',
  '.icc': 'application/vnd.iccprofile',
  '.txt': 'text/plain; charset=utf-8',
};

const CSP = [
  "default-src 'self'",
  // tesseract and pdf.js compile WebAssembly; nothing needs eval proper
  "script-src 'self' 'wasm-unsafe-eval'",
  "worker-src 'self' blob:",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' blob: data:",
  "font-src 'self' data:",
  "connect-src 'self' blob: data:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'none'",
  "frame-ancestors 'self'",
].join('; ');

const SECURITY_HEADERS: Record<string, string> = {
  'Content-Security-Policy': CSP,
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=()',
  'Cross-Origin-Opener-Policy': 'same-origin',
};

function send(res: ServerResponse, status: number, body: string, headers: Record<string, string> = {}) {
  res.writeHead(status, { ...SECURITY_HEADERS, 'Content-Length': Buffer.byteLength(body), ...headers });
  res.end(res.req.method === 'HEAD' ? undefined : body);
}

function json(res: ServerResponse, status: number, obj: unknown, headers: Record<string, string> = {}) {
  send(res, status, JSON.stringify(obj), { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers });
}

function cacheControl(rel: string): string {
  if (rel === 'index.html') return 'no-cache';
  if (rel.startsWith('assets/')) return 'public, max-age=31536000, immutable'; // content-hashed
  if (rel.startsWith('vendor/')) return 'public, max-age=604800'; // versioned by package, not by name
  return 'public, max-age=86400';
}

function resolveFile(urlPath: string): { abs: string; rel: string; stat: Stats } | null {
  let rel: string;
  try {
    rel = decodeURIComponent(urlPath.slice(BASE.length));
  } catch {
    return null;
  }
  if (rel === '' || rel.endsWith('/')) rel += 'index.html';
  if (rel.includes('\0')) return null;
  const abs = normalize(join(DIST, rel));
  if (abs !== DIST && !abs.startsWith(DIST + sep)) return null; // traversal
  try {
    const stat = statSync(abs);
    if (!stat.isFile()) return null;
    return { abs, rel: rel.split(sep).join('/'), stat };
  } catch {
    return null;
  }
}

export function handle(req: IncomingMessage, res: ServerResponse) {
  const url = new URL(req.url ?? '/', 'http://local');
  const path = url.pathname;

  if (path === `${BASE}healthz`) {
    return send(res, 200, 'ok', { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
  }

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return json(res, 405, { error: 'This demo only serves pages. Your documents are read in your browser.' }, { Allow: 'GET, HEAD' });
  }
  // No route takes a body; refuse one rather than read it.
  if (Number(req.headers['content-length'] ?? 0) > 0 || req.headers['transfer-encoding']) {
    return json(res, 413, { error: 'Request bodies are not accepted here.' });
  }

  const wait = perIp.take(clientIp(req));
  if (wait > 0) {
    return json(res, 429, { error: 'Too many requests from your address. Wait a few seconds and try again.' }, { 'Retry-After': String(wait) });
  }

  if (BASE !== '/' && (path === '/' || path === BASE.slice(0, -1))) {
    return send(res, 302, '', { Location: BASE + url.search });
  }
  if (!path.startsWith(BASE)) {
    return json(res, 404, { error: 'Not found.' });
  }

  const file = resolveFile(path);
  if (!file) return json(res, 404, { error: 'Not found.' });

  const etag = `W/"${file.stat.size.toString(16)}-${Math.floor(file.stat.mtimeMs).toString(16)}"`;
  const headers: Record<string, string> = {
    ...SECURITY_HEADERS,
    'Content-Type': MIME[extname(file.abs).toLowerCase()] ?? 'application/octet-stream',
    'Cache-Control': cacheControl(file.rel),
    ETag: etag,
  };
  if (req.headers['if-none-match'] === etag) {
    res.writeHead(304, headers);
    return res.end();
  }
  headers['Content-Length'] = String(file.stat.size);
  res.writeHead(200, headers);
  if (req.method === 'HEAD') return res.end();
  const stream = createReadStream(file.abs);
  stream.on('error', () => res.destroy());
  stream.pipe(res);
}

export function start() {
  const server = createServer((req, res) => {
    if (inFlight >= MAX_IN_FLIGHT && !req.url?.endsWith('/healthz')) {
      return json(res, 503, { error: 'The server is busy. Try again in a moment.' }, { 'Retry-After': '5' });
    }
    inFlight++;
    res.on('close', () => inFlight--);
    try {
      handle(req, res);
    } catch (e) {
      console.error('request failed', e);
      if (!res.headersSent) json(res, 500, { error: 'Something went wrong on our side.' });
      else res.destroy();
    }
  });
  server.headersTimeout = 10_000;
  server.requestTimeout = 30_000;
  server.keepAliveTimeout = 5_000;
  setInterval(() => perIp.sweep(), 60_000).unref();

  server.listen(PORT, HOST, () => console.log(`receipt-reader listening on http://${HOST}:${PORT}${BASE} (serving ${DIST})`));

  const stop = () => {
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 5000).unref();
  };
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
  return server;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) start();
