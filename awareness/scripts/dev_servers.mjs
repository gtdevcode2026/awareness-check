import http from 'node:http';
import { mkdir, writeFile, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { addImage, isSafeImageName, ALLOWED_MIME, LIBRARY_DIRNAME } from './lib/image_library.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const STATIC_PORT = 4173;
const LOG_PORT = 4175;
const HOST = '127.0.0.1';
const LOG_DIR = path.join(ROOT, 'ensemble-logs');
const IMAGE_LIB_DIR = path.join(ROOT, LIBRARY_DIRNAME);
const SAFE_NAME = /^[A-Za-z0-9._-]{1,80}$/;
const MAX_IMAGE_BYTES = 2 * 1024 * 1024;

// A single path segment safe to write inside LOG_DIR. SAFE_NAME alone is not
// enough: '.' and '..' match it yet escape the base dir (session='..' resolves
// to the app root), so reject them explicitly.
function isSafeSegment(s) {
  return SAFE_NAME.test(s) && s !== '.' && s !== '..';
}

// Confirm the resolved target really sits inside `base` (separator-aware so a
// sibling like `<base>-evil` can't satisfy a naive startsWith check).
function isInside(base, target) {
  const resolved = path.resolve(target);
  return resolved === base || resolved.startsWith(base + path.sep);
}

// Loopback-only CORS for the log/image writer. '*' previously let any website
// the user visits drive these endpoints cross-origin. Reflect only same-machine
// origins (any port) and file:// (Origin: null); no-Origin callers are
// non-browser and need no ACAO. Concrete remote origins get no ACAO -> blocked.
function allowedOrigin(origin) {
  if (!origin) return null;
  if (origin === 'null') return 'null';
  try {
    const u = new URL(origin);
    if (['127.0.0.1', 'localhost', '[::1]', '::1'].includes(u.hostname)) return origin;
  } catch { /* malformed Origin */ }
  return null;
}

function corsHeaders(req) {
  const headers = {
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Vary': 'Origin'
  };
  const allow = allowedOrigin(req?.headers?.origin);
  if (allow) headers['Access-Control-Allow-Origin'] = allow;
  return headers;
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json; charset=utf-8'
};

function safeJoin(root, urlPath) {
  const decoded = decodeURIComponent(urlPath.split('?')[0]);
  const trimmed = decoded.replace(/^\/+/, '');
  const resolved = path.resolve(root, trimmed);
  if (resolved !== root && !resolved.startsWith(root + path.sep)) return null;
  return resolved;
}

async function serveStatic(req, res) {
  let urlPath = req.url || '/';
  let fsPath = safeJoin(ROOT, urlPath === '/' ? '/index.html' : urlPath);
  if (!fsPath) {
    res.writeHead(403); res.end('forbidden'); return;
  }
  try {
    let s = await stat(fsPath);
    if (s.isDirectory()) {
      fsPath = path.join(fsPath, 'index.html');
      s = await stat(fsPath);
    }
    const ext = path.extname(fsPath).toLowerCase();
    const body = await readFile(fsPath);
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Content-Length': body.length,
      'Cache-Control': 'no-cache'
    });
    res.end(body);
  } catch (err) {
    if (err.code === 'ENOENT') { res.writeHead(404); res.end('not found'); return; }
    res.writeHead(500); res.end(err.message);
  }
}

function sendJson(req, res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json', ...corsHeaders(req) });
  res.end(JSON.stringify(body));
}

const staticServer = http.createServer((req, res) => { serveStatic(req, res); });
staticServer.listen(STATIC_PORT, HOST, () => {
  console.log(`[static] Serving ${ROOT} on http://${HOST}:${STATIC_PORT}`);
});

const logServer = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, corsHeaders(req));
    res.end();
    return;
  }
  if (req.method !== 'POST' || (req.url !== '/save' && req.url !== '/save-image')) {
    sendJson(req, res, 404, { error: 'not_found' });
    return;
  }
  const route = req.url;
  let body = '';
  req.on('data', chunk => { body += chunk; if (body.length > 4_000_000) req.destroy(); });
  req.on('end', async () => {
    try {
      const data = JSON.parse(body);
      if (route === '/save-image') {
        // Persist an uploaded Replace-image into the project so it ships with the
        // zip/server. Dev-only (server binds to 127.0.0.1). Regenerates library.js.
        const { filename, mimeType, base64 } = data;
        if (!isSafeImageName(filename)) { sendJson(req, res, 400, { error: 'bad_filename' }); return; }
        if (mimeType && !ALLOWED_MIME.has(String(mimeType))) { sendJson(req, res, 400, { error: 'bad_mime' }); return; }
        const bytes = Buffer.from(String(base64 || ''), 'base64');
        if (!bytes.length || bytes.length > MAX_IMAGE_BYTES) { sendJson(req, res, 400, { error: 'bad_size' }); return; }
        await addImage(IMAGE_LIB_DIR, filename, bytes);
        sendJson(req, res, 200, { ok: true, filename });
        return;
      }
      const { session, name, content } = data;
      if (!isSafeSegment(String(session || '')) || !isSafeSegment(String(name || ''))) {
        sendJson(req, res, 400, { error: 'bad_name' });
        return;
      }
      const dir = path.join(LOG_DIR, session);
      const file = path.join(dir, name);
      if (!isInside(LOG_DIR, file)) {
        sendJson(req, res, 400, { error: 'bad_name' });
        return;
      }
      await mkdir(dir, { recursive: true });
      await writeFile(file, typeof content === 'string' ? content : JSON.stringify(content, null, 2), 'utf8');
      sendJson(req, res, 200, { ok: true });
    } catch (err) {
      sendJson(req, res, 500, { error: err.message });
    }
  });
});
logServer.listen(LOG_PORT, HOST, () => {
  console.log(`[logs]   Ensemble log server on http://${HOST}:${LOG_PORT}`);
  console.log(`[logs]   Writing files under: ${LOG_DIR}`);
});

function shutdown() {
  try { staticServer.close(); } catch { /* ignore */ }
  try { logServer.close(); } catch { /* ignore */ }
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
