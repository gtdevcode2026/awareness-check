import http from 'node:http';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PORT = Number(process.env.ENSEMBLE_LOG_PORT) || 4175;
// Loopback by default (developer machine). In a container, set
// ENSEMBLE_LOG_HOST=0.0.0.0 so a sibling nginx container can reach it over the
// compose network. The collector still publishes no host port — only the
// reverse proxy talks to it.
const HOST = process.env.ENSEMBLE_LOG_HOST || '127.0.0.1';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LOG_DIR = path.join(ROOT, 'ensemble-logs');
const TEMPLATES_DIR = path.join(ROOT, 'templates');

const SAFE_NAME = /^[A-Za-z0-9._-]{1,80}$/;
// Template ids may start with an underscore (e.g. '_article-curation').
const SAFE_TEMPLATE_ID = /^[A-Za-z0-9._-][A-Za-z0-9._-]{0,79}$/;

// A single path segment safe to write inside LOG_DIR/TEMPLATES_DIR. The regex
// alone is NOT enough: '.' and '..' match it yet would escape the base dir
// (e.g. session='..' resolves to the app root), so reject them explicitly.
function isSafeSegment(re, s) {
  return re.test(s) && s !== '.' && s !== '..';
}

// Belt-and-suspenders: confirm the resolved target really sits inside `base`
// (separator-aware so a sibling like `<base>-evil` can't satisfy the check).
function isInside(base, target) {
  const resolved = path.resolve(target);
  return resolved === base || resolved.startsWith(base + path.sep);
}

// Loopback-only CORS. The previous '*' let ANY website the user visits drive
// this loopback writer cross-origin. Reflect only same-machine origins (any
// port) and file:// (Origin: null); requests with no Origin are non-browser
// callers and need no ACAO. Concrete remote origins get no ACAO -> blocked.
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

function sendJson(req, res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json', ...corsHeaders(req) });
  res.end(JSON.stringify(body));
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, corsHeaders(req));
    res.end();
    return;
  }
  if (req.method !== 'POST' || req.url !== '/save') {
    sendJson(req, res, 404, { error: 'not_found' });
    return;
  }
  let body = '';
  req.on('data', chunk => { body += chunk; if (body.length > 2_000_000) req.destroy(); });
  req.on('end', async () => {
    try {
      const { session, name, content, template_id } = JSON.parse(body);
      if (!isSafeSegment(SAFE_NAME, String(session || '')) || !isSafeSegment(SAFE_NAME, String(name || ''))) {
        sendJson(req, res, 400, { error: 'bad_name' });
        return;
      }
      const payload = typeof content === 'string' ? content : JSON.stringify(content, null, 2);

      // Canonical write — UNCHANGED. Existing tools, scripts, and reviewers
      // continue to read from ensemble-logs/<session>/<name>.
      const canonicalDir = path.join(LOG_DIR, session);
      const canonicalFile = path.join(canonicalDir, name);
      if (!isInside(LOG_DIR, canonicalFile)) {
        sendJson(req, res, 400, { error: 'bad_name' });
        return;
      }
      await mkdir(canonicalDir, { recursive: true });
      await writeFile(canonicalFile, payload, 'utf8');

      // Per-template mirror — opt-in via template_id. Auto-creates the folder
      // (covers agentic-pipeline-generated template ids not in the upfront
      // scaffold). Silently skipped if template_id is missing or malformed.
      let mirroredTo = null;
      if (template_id != null) {
        const tplId = String(template_id);
        if (isSafeSegment(SAFE_TEMPLATE_ID, tplId)) {
          const tplFile = path.join(TEMPLATES_DIR, tplId, 'ensemble-logs', session, name);
          if (isInside(TEMPLATES_DIR, tplFile)) {
            try {
              await mkdir(path.dirname(tplFile), { recursive: true });
              await writeFile(tplFile, payload, 'utf8');
              mirroredTo = path.relative(ROOT, tplFile);
            } catch (mirrorErr) {
              // Mirror failure is non-fatal — canonical write succeeded.
              console.warn(`[ensemble-log] mirror failed for template_id=${tplId}: ${mirrorErr.message}`);
            }
          }
        }
      }

      sendJson(req, res, 200, { ok: true, mirrored: mirroredTo });
    } catch (err) {
      sendJson(req, res, 500, { error: err.message });
    }
  });
});

server.listen(PORT, HOST, () => {
  console.log(`Ensemble log server listening on http://${HOST}:${PORT}`);
  console.log(`Writing files under: ${LOG_DIR}`);
});
