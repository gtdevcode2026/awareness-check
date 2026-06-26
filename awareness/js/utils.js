/* ═══════════════════════════════════════════════════════════
   utils.js — Shared utilities for the Security Awareness App
   ═══════════════════════════════════════════════════════════ */
window.App = window.App || {};

App.Utils = (() => {
  'use strict';

  // ── Logging ──
  const logEl = () => document.getElementById('status-log');

  function log(msg, cls = '') {
    const el = logEl();
    if (!el) return;
    el.style.display = 'block';
    const div = document.createElement('div');
    if (cls) div.className = cls;
    const ts = new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    div.innerHTML = `<span style="opacity:.4;margin-right:.5rem;font-size:.62rem">[${ts}]</span> › ${msg}`;
    el.appendChild(div);
    el.scrollTop = el.scrollHeight;
  }

  function clearLog() {
    const el = logEl();
    if (el) { el.style.display = 'none'; el.innerHTML = ''; }
  }

  // ── Date helpers ──
  function fmtDate(d) {
    try {
      return new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
    } catch (e) { return d || ''; }
  }

  function daysAgo(dateStr) {
    try {
      const ts = new Date(dateStr).getTime();
      if (!Number.isFinite(ts)) return 'Date unknown';
      const diff = Date.now() - ts;
      const days = Math.floor(diff / 864e5);
      if (days <= 0) return 'Today';
      if (days === 1) return 'Yesterday';
      return `${days} days ago`;
    } catch (e) { return 'Date unknown'; }
  }

  function isWithinDays(dateStr, days) {
    if (days === 0) return true;
    try {
      const ts = new Date(dateStr).getTime();
      // Keep undated feed items visible instead of hiding all cards.
      if (!Number.isFinite(ts)) return true;
      return ts >= (Date.now() - days * 864e5);
    } catch (e) { return true; }
  }

  // ── Convert inline SVGs to base64 <img> tags for email compatibility ──
  function svgsToBase64(html) {
    const tmp = document.createElement('div');
    tmp.innerHTML = html;
    tmp.querySelectorAll('svg').forEach(svg => {
      try {
        // Serialize SVG, encode to base64 data URI
        const serializer = new XMLSerializer();
        let svgStr = serializer.serializeToString(svg);
        // Ensure xmlns is present
        if (!svgStr.includes('xmlns=')) {
          svgStr = svgStr.replace('<svg', '<svg xmlns="http://www.w3.org/2000/svg"');
        }
        const b64 = btoa(unescape(encodeURIComponent(svgStr)));
        const dataUri = `data:image/svg+xml;base64,${b64}`;
        // Create img replacement
        const img = document.createElement('img');
        img.src = dataUri;
        img.alt = 'Security illustration';
        // Preserve dimensions
        const w = svg.getAttribute('width') || svg.style.width || '';
        const h = svg.getAttribute('height') || svg.style.height || '';
        if (w) img.setAttribute('width', w.replace('px', ''));
        if (h) img.setAttribute('height', h.replace('px', ''));
        img.style.cssText = svg.style.cssText || '';
        img.style.display = 'inline-block';
        img.style.verticalAlign = 'middle';
        svg.parentNode.replaceChild(img, svg);
      } catch (e) { /* skip SVGs that fail to serialize */ }
    });
    return tmp.innerHTML;
  }

  // ── Inline all CSS custom properties for email ──
  function inlineCSSVars(html) {
    const vars = {
      'var(--blk)': '#0A0A0A', 'var(--blk2)': '#111', 'var(--blk3)': '#1C1C1C',
      'var(--gold)': '#B8860B', 'var(--gold-hi)': '#D4A420', 'var(--gold-bar)': '#C09010',
      'var(--cream)': '#F4EFE7', 'var(--cream2)': '#EAE4DA',
      'var(--wh)': '#FFF', 'var(--gray)': '#888', 'var(--gray2)': '#CCC',
      'var(--red)': '#C0392B', 'var(--grn)': '#1E7A46',
      'var(--bw)': 'rgba(255,255,255,.09)', 'var(--bg)': 'rgba(184,134,11,.18)'
    };
    let out = html;
    for (const [varName, value] of Object.entries(vars)) {
      out = out.split(varName).join(value);
    }
    return out;
  }

  // ── Clipboard: email-safe HTML with base64 images ──
  function buildEmailSafeHTMLFromElement(el) {
    if (!el) return '';
    let html = el.outerHTML;
    html = svgsToBase64(html);
    html = inlineCSSVars(html);
    html = flattenEmailColors(html);
    html = enforceEmailFont(html);
    return html;
  }

  /**
   * Plain-text fallback for clipboard (rich paste uses HTML separately).
   * Preserves line breaks and bullet lines so paste-as-text still resembles the layout.
   */
  function plainTextFromClipboardHtml(html) {
    const raw = String(html || '');
    if (typeof document === 'undefined') return stripTags(raw);
    const tmp = document.createElement('div');
    tmp.innerHTML = raw;
    tmp.querySelectorAll('script,style').forEach((n) => n.remove());

    const parts = [];
    function walk(node) {
      if (node.nodeType === 3) {
        parts.push(node.nodeValue || '');
        return;
      }
      if (node.nodeType !== 1) return;
      const tag = (node.tagName || '').toLowerCase();
      if (tag === 'br') {
        parts.push('\n');
        return;
      }
      if (tag === 'li') {
        parts.push('\n• ');
        Array.from(node.childNodes).forEach(walk);
        return;
      }
      if (tag === 'p' || /^h[1-6]$/.test(tag) || tag === 'blockquote') {
        parts.push('\n');
        Array.from(node.childNodes).forEach(walk);
        parts.push('\n');
        return;
      }
      if (tag === 'tr') {
        parts.push('\n');
        Array.from(node.childNodes).forEach(walk);
        return;
      }
      Array.from(node.childNodes).forEach(walk);
    }
    Array.from(tmp.childNodes).forEach(walk);
    return parts
      .join('')
      .replace(/[ \t\f\v]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  function writeRichClipboard(htmlString, plainText) {
    if (
      typeof navigator !== 'undefined' &&
      navigator.clipboard &&
      typeof navigator.clipboard.write === 'function' &&
      typeof ClipboardItem === 'function'
    ) {
      const htmlBlob = new Blob([htmlString], { type: 'text/html' });
      const textBlob = new Blob([plainText], { type: 'text/plain' });
      return navigator.clipboard.write([
        new ClipboardItem({
          'text/html': htmlBlob,
          'text/plain': textBlob,
        }),
      ]);
    }
    return Promise.reject(new Error('rich clipboard unavailable'));
  }

  function copyHTML(elId, htmlOverride = null) {
    const el = document.getElementById(elId);
    if (!el && !htmlOverride) return;
    showToast('Converting images to base64 for email…');
    let builtHtml = '';
    try {
      if (htmlOverride) {
        const tmp = document.createElement('div');
        tmp.innerHTML = htmlOverride;
        builtHtml = buildEmailSafeHTMLFromElement(tmp);
      } else {
        builtHtml = buildEmailSafeHTMLFromElement(el);
      }
      const plain = plainTextFromClipboardHtml(builtHtml);
      writeRichClipboard(builtHtml, plain)
        .then(() => showToast('Copied — rich HTML and plain text (paste into Outlook, Gmail, Word).'))
        .catch(() =>
          navigator.clipboard.writeText(builtHtml).then(() =>
            showToast('Email-ready HTML copied! All images embedded as base64.')
          )
        )
        .catch(() => showToast('Copy failed — select manually.', true));
    } catch (e) {
      const fallback = builtHtml || el?.outerHTML || String(htmlOverride || '');
      navigator.clipboard
        .writeText(fallback)
        .then(() => showToast('HTML copied (some images may not display in email).'))
        .catch(() => showToast('Copy failed — select manually.', true));
    }
  }

  function downloadHTML(filename, html) {
    try {
      const blob = new Blob([html], { type: 'text/html' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 1200);
    } catch (e) {
      showToast('Download failed.', true);
    }
  }

  /**
   * Wrap a full HTML document string in an SVG using foreignObject so it can be saved as .svg.
   * Uses the same rendering pipeline as standalone HTML (DOMParser + XMLSerializer).
   */
  function htmlToSvgExport(fullHtml, opts = {}) {
    const width = opts.width != null ? opts.width : 800;
    const height = opts.height != null ? opts.height : 4000;
    if (typeof DOMParser === 'undefined' || typeof XMLSerializer === 'undefined') {
      return `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><!-- DOMParser/XMLSerializer unavailable --></svg>`;
    }
    try {
      const doc = new DOMParser().parseFromString(fullHtml, 'text/html');
      const body = doc.body;
      if (!body) {
        return `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"></svg>`;
      }
      const serializer = new XMLSerializer();
      let inner = serializer.serializeToString(body);
      inner = inner.replace(/^<body\b[^>]*>/i, '<div xmlns="http://www.w3.org/1999/xhtml">').replace(/<\/body>\s*$/i, '</div>');
      return (
        `<?xml version="1.0" encoding="UTF-8"?>\n` +
        `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">\n` +
        `<foreignObject width="${width}" height="${height}">\n${inner}\n</foreignObject>\n` +
        `</svg>`
      );
    } catch (e) {
      return `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"></svg>`;
    }
  }

  function downloadSVG(filename, svgMarkup) {
    try {
      const blob = new Blob([svgMarkup], { type: 'image/svg+xml;charset=utf-8' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 1200);
    } catch (e) {
      showToast('SVG download failed.', true);
    }
  }

  function downloadBlob(filename, blob) {
    try {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 1200);
    } catch (e) {
      showToast('Download failed.', true);
    }
  }

  /**
   * Rewrite <img src="assets/X.Y"> references to <img src="cid:..."> and
   * collect the matching attachments[] for the relay to inline as
   * multipart/related parts.
   *
   * Used so emails render images automatically in Outlook + Gmail (no
   * "display images" prompt). The Graph relay forwards each entry as
   * an inline file attachment carrying its contentId.
   *
   * @param {string} html
   * @param {(path:string)=>Promise<string>} fetcher — returns base64 of the asset file
   * @returns {Promise<{html:string, attachments:Array<{contentId,contentType,base64,filename}>}>}
   */
  async function inlineCidAttachments(html, fetcher) {
    const raw = String(html || '');
    if (!raw || typeof fetcher !== 'function') return { html: raw, attachments: [] };
    const re = /src=(["'])assets\/([^"']+)\1/g;
    const uniquePaths = new Set();
    let m;
    while ((m = re.exec(raw)) !== null) uniquePaths.add('assets/' + m[2]);
    if (!uniquePaths.size) return { html: raw, attachments: [] };

    const cidByPath = new Map();
    const attachments = [];
    for (const p of uniquePaths) {
      try {
        const base64 = await fetcher(p);
        const filename = p.split('/').pop();
        const contentId = 'aw-' + filename.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
        const lower = filename.toLowerCase();
        const contentType =
          lower.endsWith('.png')  ? 'image/png' :
          lower.endsWith('.jpg')  ? 'image/jpeg' :
          lower.endsWith('.jpeg') ? 'image/jpeg' :
          lower.endsWith('.gif')  ? 'image/gif' :
          lower.endsWith('.svg')  ? 'image/svg+xml' :
          lower.endsWith('.webp') ? 'image/webp' :
          'application/octet-stream';
        attachments.push({ contentId, contentType, base64: String(base64 || ''), filename });
        cidByPath.set(p, contentId);
      } catch (_e) {
        // Skip un-fetchable assets — the email still sends, just with a
        // broken <img> reference (same as today's behavior).
      }
    }

    const newHtml = raw.replace(re, (full, quote, rel) => {
      const cid = cidByPath.get('assets/' + rel);
      return cid ? `src=${quote}cid:${cid}${quote}` : full;
    });
    return { html: newHtml, attachments };
  }

  /**
   * Rewrite inline <img src="data:image/...;base64,..."> to <img src="cid:...">
   * and return matching inline attachments[] for the relay. Classic Outlook
   * (and Gmail) refuse to render base64 data: images, but DO render CID inline
   * attachments — so this is what makes the QR code and embedded illustrations
   * appear in those clients. Send-path only (templates/preview keep the data:
   * URIs untouched). Identical data: URIs are de-duped to a single attachment.
   * Non-base64 data: URIs (e.g. raw svg) are left as-is.
   *
   * @param {string} html
   * @returns {{html:string, attachments:Array<{contentId,contentType,base64,filename}>}}
   */
  function inlineDataUriAttachments(html) {
    const raw = String(html || '');
    if (!raw || raw.indexOf('data:image') === -1) return { html: raw, attachments: [] };
    const re = /src=(["'])(data:image\/([a-z0-9.+-]+);base64,([A-Za-z0-9+/=]+))\1/gi;
    const cidByData = new Map();
    const attachments = [];
    let counter = 0;
    const newHtml = raw.replace(re, (full, quote, dataUri, subtype, base64) => {
      let cid = cidByData.get(dataUri);
      if (!cid) {
        counter += 1;
        const sub = String(subtype || '').toLowerCase();
        const contentType = 'image/' + (sub === 'jpg' ? 'jpeg' : sub);
        const ext = sub === 'jpeg' ? 'jpg' : (sub === 'svg+xml' ? 'svg' : sub) || 'img';
        cid = 'aw-inline-' + counter;
        attachments.push({ contentId: cid, contentType, base64, filename: 'inline-' + counter + '.' + ext });
        cidByData.set(dataUri, cid);
      }
      return `src=${quote}cid:${cid}${quote}`;
    });
    return { html: newHtml, attachments };
  }

  function _toBase64Utf8(str) {
    const bin = unescape(encodeURIComponent(String(str)));
    if (typeof btoa === 'function') return btoa(bin);
    if (typeof window !== 'undefined' && typeof window.btoa === 'function') return window.btoa(bin);
    if (typeof Buffer !== 'undefined') return Buffer.from(String(str), 'utf8').toString('base64');
    return bin;
  }

  function _wrap76(s) {
    const str = String(s).replace(/\s+/g, '');
    const out = [];
    for (let i = 0; i < str.length; i += 76) out.push(str.slice(i, i + 76));
    return out.join('\r\n');
  }

  function _encodeMimeHeader(s) {
    const str = String(s);
    let ascii = true;
    for (let i = 0; i < str.length; i += 1) {
      if (str.charCodeAt(i) > 127) { ascii = false; break; }
    }
    return ascii ? str : '=?utf-8?B?' + _toBase64Utf8(str) + '?=';
  }

  // Encode an address header value. "Naïve Name <a@b.com>" → the display name is
  // RFC 2047-encoded but the <addr@domain> is left literal so Outlook still parses
  // the address; a bare address or bare name passes through _encodeMimeHeader.
  function _encodeMimeAddress(s) {
    const str = String(s).trim();
    const m = str.match(/^(.*?)\s*<([^>]+)>\s*$/);
    if (m) {
      const name = m[1].replace(/^"|"$/g, '').trim();
      return (name ? _encodeMimeHeader(name) + ' ' : '') + '<' + m[2].trim() + '>';
    }
    return _encodeMimeHeader(str);
  }

  /**
   * Build a complete RFC 822 .eml message (multipart/related) from already
   * cid-rewritten HTML + its inline attachments. The `X-Unsent: 1` header makes
   * classic Outlook open the file as an editable, sendable draft (not read-only)
   * with images inline — so a user can "download .eml → open → add recipients →
   * Send" with no relay. `attachments` come from inlineCidAttachments /
   * inlineDataUriAttachments (each {contentId, contentType, base64, filename}).
   *
   * @param {string} html — HTML whose <img src> already reference cid:<id>
   * @param {Array<{contentId,contentType,base64,filename}>} attachments
   * @param {{subject?:string, to?:string, from?:string}} [opts]
   * @returns {string} the .eml message text
   */
  function buildEmlMime(html, attachments, opts) {
    const o = opts || {};
    const subject = String(o.subject || 'Security Awareness Newsletter');
    const from = o.from == null ? '' : String(o.from).trim();
    const to = o.to == null ? '' : String(o.to).trim();
    const atts = Array.isArray(attachments) ? attachments.filter(a => a && a.contentId && a.base64) : [];
    const boundary = '=_aw_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 10);
    const lines = [
      'MIME-Version: 1.0',
      'X-Unsent: 1',
      'Subject: ' + _encodeMimeHeader(subject)
    ];
    // Optional From/To — emitted only when provided so the subject-only newsletter
    // caller is byte-for-byte unchanged. Outlook honors To: as a prefilled
    // recipient on the X-Unsent draft.
    if (from) lines.push('From: ' + _encodeMimeAddress(from));
    if (to) lines.push('To: ' + _encodeMimeAddress(to));
    if (atts.length) {
      lines.push('Content-Type: multipart/related; type="text/html"; boundary="' + boundary + '"');
      lines.push('');
      lines.push('--' + boundary);
      lines.push('Content-Type: text/html; charset="utf-8"');
      lines.push('Content-Transfer-Encoding: base64');
      lines.push('');
      lines.push(_wrap76(_toBase64Utf8(html)));
      for (const a of atts) {
        const fn = String(a.filename || a.contentId).replace(/"/g, '');
        lines.push('--' + boundary);
        lines.push('Content-Type: ' + (a.contentType || 'application/octet-stream') + '; name="' + fn + '"');
        lines.push('Content-Transfer-Encoding: base64');
        lines.push('Content-ID: <' + a.contentId + '>');
        lines.push('Content-Disposition: inline; filename="' + fn + '"');
        lines.push('');
        lines.push(_wrap76(a.base64));
      }
      lines.push('--' + boundary + '--');
      lines.push('');
    } else {
      lines.push('Content-Type: text/html; charset="utf-8"');
      lines.push('Content-Transfer-Encoding: base64');
      lines.push('');
      lines.push(_wrap76(_toBase64Utf8(html)));
      lines.push('');
    }
    return lines.join('\r\n');
  }

  /**
   * Stack several standalone advisory HTML documents into ONE combined standalone
   * document (so a cluster of advisories becomes a single Outlook draft). Combines
   * BEFORE image inlining, so the caller can run image→cid once over the whole doc
   * and CIDs stay globally unique/deduped.
   *
   * Each input is a full <!DOCTYPE html>… document. We lift each <body> inner, keep
   * the first doc's <body> attributes + any <head> <style> blocks, and join with an
   * invisible email-safe spacer carrying an `advisory-break` marker.
   *
   * @param {string[]} docs — full standalone HTML documents (advisory template output)
   * @param {{lang?:string}} [opts]
   * @returns {string} one combined standalone HTML document
   */
  function combineHtmlBodies(docs, opts) {
    const list = (Array.isArray(docs) ? docs : []).map(d => String(d || '')).filter(Boolean);
    if (!list.length) return '';
    const lang = (opts && opts.lang) ? String(opts.lang) : 'en';
    const bodyInner = (doc) => {
      const m = doc.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
      return m ? m[1] : doc;
    };
    const firstBodyAttrs = (() => {
      const m = list[0].match(/<body([^>]*)>/i);
      return m ? m[1] : '';
    })();
    const headStyles = (() => {
      const head = (list[0].match(/<head[^>]*>([\s\S]*?)<\/head>/i) || ['', ''])[1];
      return (head.match(/<style[\s\S]*?<\/style>/gi) || []).join('\n');
    })();
    const SEP = '\n<div style="height:28px;line-height:28px;font-size:0;mso-line-height-rule:exactly">&nbsp;</div>\n<!--advisory-break-->\n';
    const bodies = list.map(bodyInner).join(SEP);
    return '<!DOCTYPE html><html lang="' + lang + '"><head>' +
      '<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">' +
      headStyles +
      '</head><body' + firstBodyAttrs + '>' + bodies + '</body></html>';
  }

  /**
   * Stable, filesystem-safe per-advisory .eml filename: prefers the CVE id (or the
   * ABSOC ticket), falls back to advisory-<index>. Returns `advisory-<sanitized>.eml`.
   */
  function emlFileName(cveOrTicket, fallbackIndex) {
    const base = String(cveOrTicket || '').trim() || ('advisory-' + (fallbackIndex || 1));
    const safe = base.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) ||
      ('advisory-' + (fallbackIndex || 1));
    return 'advisory-' + safe + '.eml';
  }

  /**
   * Replace contents of #nl-qr with an inline PNG data-URI image (email/offline/SVG-safe).
   */
  function injectNlQrImageIntoHtml(bodyHtml, dataUri) {
    const raw = String(bodyHtml || '');
    const uri = String(dataUri || '').trim();
    if (!uri || !raw.includes('nl-qr')) return raw;
    if (typeof DOMParser === 'undefined') return raw;
    try {
      const doc = new DOMParser().parseFromString(
        `<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body>${raw}</body></html>`,
        'text/html'
      );
      const qr = doc.body.querySelector('#nl-qr');
      if (!qr) return raw;
      // Per-template display size via data-qr-size (PNG stays high-res; downscaled = crisp). Default 144.
      const size = parseInt(qr.getAttribute('data-qr-size'), 10) || 144;
      qr.innerHTML = '';
      const img = doc.createElement('img');
      img.setAttribute('src', uri);
      img.setAttribute('alt', 'QR code');
      img.setAttribute('width', String(size));
      img.setAttribute('height', String(size));
      img.setAttribute('style', `display:block;width:${size}px;height:${size}px;`);
      qr.appendChild(img);
      return doc.body.innerHTML;
    } catch (e) {
      return raw;
    }
  }

  // ── Toast notifications ──
  function showToast(msg, isError = false) {
    let container = document.getElementById('toast-container');
    if (!container) {
      container = document.createElement('div');
      container.id = 'toast-container';
      container.style.cssText = 'position:fixed;top:1.2rem;right:1.2rem;z-index:9999;display:flex;flex-direction:column;gap:.5rem;pointer-events:none';
      document.body.appendChild(container);
    }
    const toast = document.createElement('div');
    toast.style.cssText = `
      pointer-events:auto;padding:.72rem 1.2rem;border-radius:6px;font-size:.8rem;font-weight:500;
      font-family:'DM Sans',sans-serif;backdrop-filter:blur(16px);border:1px solid;
      transform:translateX(120%);transition:transform .3s cubic-bezier(.4,0,.2,1),opacity .3s;
      ${isError
        ? 'background:rgba(192,57,43,.18);border-color:rgba(192,57,43,.4);color:#E74C3C'
        : 'background:rgba(184,134,11,.18);border-color:rgba(184,134,11,.4);color:#D4A420'}`;
    toast.textContent = msg;
    container.appendChild(toast);
    requestAnimationFrame(() => toast.style.transform = 'translateX(0)');
    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateX(120%)';
      setTimeout(() => toast.remove(), 350);
    }, 3200);
  }

  // ── Skeleton loader ──
  function skeleton(count = 4) {
    return Array.from({ length: count }, () => `
      <div style="background:rgba(255,255,255,.025);border:1px solid rgba(255,255,255,.07);border-radius:8px;padding:1.1rem;margin-bottom:.72rem">
        <div class="sk" style="width:22%;height:10px;margin-bottom:.45rem"></div>
        <div class="sk" style="width:78%;height:14px;margin-bottom:.35rem"></div>
        <div class="sk" style="width:92%;height:11px;margin-bottom:.2rem"></div>
        <div class="sk" style="width:58%;height:11px;margin-bottom:.55rem"></div>
        <div style="display:flex;gap:.5rem">
          <div class="sk" style="width:60px;height:18px;border-radius:3px"></div>
          <div class="sk" style="width:80px;height:18px;border-radius:3px"></div>
        </div>
      </div>`).join('');
  }

  // ── Debounce ──
  function debounce(fn, ms = 300) {
    let timer;
    return (...args) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), ms); };
  }

  // ── Simple wait ──
  function wait(ms) { return new Promise(r => setTimeout(r, ms)); }

  // ── Sanitize HTML entities ──
  function esc(str) {
    const d = document.createElement('div');
    d.appendChild(document.createTextNode(str));
    return d.innerHTML;
  }

  // ── Strip HTML tags ──
  function stripTags(html) {
    const tmp = document.createElement('div');
    tmp.innerHTML = html;
    return tmp.textContent || tmp.innerText || '';
  }

  // ── Truncate text ──
  function truncate(str, len = 160) {
    if (!str || str.length <= len) return str;
    return str.slice(0, len).replace(/\s+\S*$/, '') + '…';
  }

  /**
   * When newsletter HTML is saved and opened as file://, href="google.com" resolves to a path beside the file.
   * Normalize bare hosts and scheme-less URLs to absolute https (mailto:, tel:, existing schemes unchanged).
   */
  function normalizeWebUrl(raw) {
    const s = String(raw || '').trim();
    if (!s) return '';
    const lower = s.toLowerCase();
    if (lower.startsWith('mailto:') || lower.startsWith('tel:') || lower.startsWith('sms:')) return s;
    // Reject executable / data schemes so a crafted Portal URL can never become an
    // active href in the rendered newsletter or the emailed copy (stored XSS).
    if (/^(?:javascript|data|vbscript|file):/i.test(lower)) return '';
    if (/^[a-z][a-z0-9+.-]*:/i.test(s)) return s;
    if (lower.startsWith('//')) return `https:${s}`;
    if (s.startsWith('#') || s.startsWith('/') || s.startsWith('\\')) return s;
    if (/\s/.test(s)) return s;
    return `https://${s.replace(/^\/+/, '')}`;
  }

  // Wire a poster's footer "Visit Portal" call-to-action to the configured portal.
  // The static-replica posters (gen_wifi_safety, gen_horizontal_brief, …) ship the
  // CTA as a DEAD `<a href="#">Visit Portal</a>` because the real URL is per-user
  // (cfg.portal), meant to be injected at build time — so the button did nothing.
  // This rewrites that dead anchor to point at `href` and open in a new tab. It is
  // a pure string op (no DOM), so it works both at build time AND when healing the
  // variant HTML frozen inside a previously saved project (rendered before the CTA
  // was wired). Only the "Visit Portal" anchor with an empty/`#` href is touched —
  // anchors with a real href, or other dead links (e.g. the source "Read article"
  // link), are left alone. No usable href → the HTML is returned unchanged.
  function wireVisitPortalCta(html, href) {
    if (typeof html !== 'string' || !html) return html;
    const url = String(href || '').trim();
    if (!url || url === '#') return html;
    const safe = url.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
    return html.replace(
      /<a\b([^>]*?)href="#?"([^>]*?)>([^<]*Visit Portal[^<]*)<\/a>/gi,
      (full, pre, post, label) => {
        const attrs = pre + post;
        const tgt = /\btarget\s*=/i.test(attrs) ? '' : ' target="_blank"';
        const rel = /\brel\s*=/i.test(attrs) ? '' : ' rel="noopener noreferrer"';
        return `<a${pre}href="${safe}"${post}${tgt}${rel}>${label}</a>`;
      }
    );
  }

  // The "See something suspicious" capsule (Phishing-Maestro pill) shown above the
  // Wi-Fi poster's Report-to-SOC button. Single source of truth so the template and
  // the saved-project heal stay byte-identical.
  const WIFI_SOC_CAPSULE =
    '<table data-soc-capsule="1" align="center" border="0" cellpadding="0" cellspacing="0" role="presentation" style="border-collapse:separate;margin:0 auto 24px;">'
    + '<tr><td align="center" valign="middle" bgcolor="#231d0d" style="background-color:#231d0d;border:1px solid #5d4915;border-radius:20px;padding:6px 14px;text-align:center;">'
    + '<span style="font-family:Arial,Helvetica,sans-serif;font-size:10px;color:#D4A420;font-weight:700;letter-spacing:2px;text-transform:uppercase;">&#9679; See something suspicious</span>'
    + '</td></tr></table>';

  // Add the "See something suspicious" capsule above the Wi-Fi poster's Report-to-SOC
  // button in variant HTML frozen in a previously saved project (new builds ship it).
  // Scoped to Wi-Fi only (gated on the nl-wifi markers so other templates that share
  // the SOC button are untouched) and idempotent (skips when data-soc-capsule exists).
  // Anchors on the report cell's unique padding, so it survives a DOM round-trip.
  function injectWifiSocCapsule(html) {
    if (typeof html !== 'string' || !html) return html;
    if (!/id="nl-wifi-tip/.test(html)) return html;     // Wi-Fi poster only
    if (html.indexOf('data-soc-capsule') !== -1) return html; // already present
    return html.replace(/(<td\b[^>]*padding:14px 30px 20px[^>]*>)/i, (m) => m + WIFI_SOC_CAPSULE);
  }

  // Strip the near-black 1px framing border the Cyber Gazette incident hero images
  // used to ship (`border:1px solid #0A0A0A`). NEW builds no longer emit it, but
  // variant HTML frozen in a previously saved project keeps the black box until
  // regenerated — this removes it from that stored HTML on load. The string is
  // unique to that image style (no other template emits it), so the strip is safe
  // to run over a whole variant. A safe no-op when the border isn't present.
  function stripGazetteIncidentImageBorder(html) {
    if (typeof html !== 'string' || !html) return html;
    return html.replace(/border:1px solid #0A0A0A;?/gi, '');
  }

  /** Remove legacy footer classification segment from saved newsletter HTML (workspace snapshots pre-removal). */
  function stripLegacyFooterClassification(html) {
    const s = String(html || '');
    if (!s.includes('Security Awareness') || !s.includes('mailto:')) return s;
    const dot = '(?:·|&middot;|&#183;|\u00b7)';
    const re = new RegExp(
      `Security Awareness\\s*${dot}\\s*[\\s\\S]{0,500}?\\s*${dot}\\s*(<a\\s+href="mailto:)`,
      'gi'
    );
    return s.replace(re, 'Security Awareness · $1');
  }

  /**
   * After removing a node, walk UP and prune any ancestor that became structurally
   * empty (no non-whitespace text and no meaningful element children). Stops before
   * `stopAt` (the parsed <body>) and never touches locked elements. Mirror of the
   * editor iframe's pruneEmptyAncestors so cross-language "Remove in all languages"
   * leaves no hollow wrappers / vertical gaps, exactly like the in-iframe "Remove".
   */
  function pruneEmptyAncestorsInDoc(parent, stopAt) {
    let node = parent;
    while (node && node !== stopAt && node.nodeType === 1) {
      if (node.getAttribute && node.getAttribute('data-nl-lock') === '1') break;
      if ((node.textContent || '').replace(/\s+/g, '') !== '') break;
      let keep = false;
      const kids = node.children || [];
      for (let i = 0; i < kids.length; i += 1) {
        const tn = kids[i].tagName;
        if (tn === 'IMG' || tn === 'HR' || tn === 'INPUT' || tn === 'SVG' || tn === 'CANVAS' || tn === 'VIDEO') { keep = true; break; }
      }
      if (keep) break;
      const up = node.parentElement;
      try { node.remove(); } catch (e) { break; }
      node = up;
    }
  }

  /**
   * Remove one element from serialized newsletter HTML using the same body→child index
   * path as the editor iframe (element children only). Used to mirror deletes across languages.
   */
  function removeNewsletterNodeByBodyChildPath(html, path) {
    const h = String(html || '');
    if (!path || !Array.isArray(path) || path.length === 0) return { html: h, removed: false };
    if (typeof DOMParser === 'undefined') return { html: h, removed: false };
    try {
      const doc = new DOMParser().parseFromString(
        `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body>${h}</body></html>`,
        'text/html'
      );
      const body = doc.body;
      if (!body) return { html: h, removed: false };
      let cur = body;
      for (let i = 0; i < path.length; i += 1) {
        const idx = path[i];
        if (!Number.isFinite(idx) || idx < 0 || idx >= cur.children.length) {
          return { html: h, removed: false };
        }
        cur = cur.children[idx];
      }
      if (cur === body) return { html: h, removed: false };
      // Never delete the whole-newsletter wrapper — guards a drifted/over-short path
      // (e.g. from the maxPathSkip flex below) from collapsing onto the root and
      // wiping the entire body.
      if (cur.nodeType === 1 && (cur.hasAttribute('data-nl-import-body') || cur.hasAttribute('data-template-id'))) {
        return { html: h, removed: false };
      }
      const parent = cur.parentElement;
      cur.remove();
      pruneEmptyAncestorsInDoc(parent, body);
      return { html: body.innerHTML, removed: true };
    } catch (e) {
      return { html: h, removed: false };
    }
  }

  /**
   * Same as removeNewsletterNodeByBodyChildPath but paths are relative to the first
   * [data-template-id] node (newsletter root). Skips leading style/script/banner drift across languages.
   */
  function removeNewsletterNodeByTemplateChildPath(html, relPath) {
    const h = String(html || '');
    if (!relPath || !Array.isArray(relPath) || relPath.length === 0) return { html: h, removed: false };
    if (typeof DOMParser === 'undefined') return { html: h, removed: false };
    try {
      const doc = new DOMParser().parseFromString(
        `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body>${h}</body></html>`,
        'text/html'
      );
      const body = doc.body;
      if (!body) return { html: h, removed: false };
      const root = body.querySelector('[data-template-id]');
      if (!root) return { html: h, removed: false };
      let cur = root;
      for (let i = 0; i < relPath.length; i += 1) {
        const idx = relPath[i];
        if (!Number.isFinite(idx) || idx < 0 || idx >= cur.children.length) {
          return { html: h, removed: false };
        }
        cur = cur.children[idx];
      }
      if (cur === root) return { html: h, removed: false };
      if (cur.nodeType === 1 && cur.hasAttribute('data-nl-import-body')) return { html: h, removed: false };
      const parent = cur.parentElement;
      cur.remove();
      pruneEmptyAncestorsInDoc(parent, body);
      return { html: body.innerHTML, removed: true };
    } catch (e) {
      return { html: h, removed: false };
    }
  }

  /**
   * Cross-language delete: prefer path inside [data-template-id], then full body path,
   * then body path with up to maxPathSkip leading indices dropped (handles extra/missing style/script).
   */
  function removeNewsletterNodeByMirrorPath(html, pathBody, relPath, maxPathSkip = 4) {
    const h = String(html || '');
    const byTpl = removeNewsletterNodeByTemplateChildPath(h, relPath);
    if (byTpl.removed) return byTpl;
    if (pathBody && pathBody.length) {
      const exact = removeNewsletterNodeByBodyChildPath(h, pathBody);
      if (exact.removed) return exact;
      const limit = Math.min(maxPathSkip, Math.max(0, pathBody.length - 1));
      for (let skip = 1; skip <= limit; skip += 1) {
        const flex = removeNewsletterNodeByBodyChildPath(h, pathBody.slice(skip));
        if (flex.removed) return flex;
      }
    }
    return { html: h, removed: false };
  }

  /**
   * Set textContent on one element (mirror of removeNewsletterNodeByBodyChildPath).
   */
  function updateNewsletterNodeTextByBodyChildPath(html, path, text) {
    const h = String(html || '');
    const next = String(text ?? '');
    if (!path || !Array.isArray(path) || path.length === 0) return { html: h, updated: false };
    if (typeof DOMParser === 'undefined') return { html: h, updated: false };
    try {
      const doc = new DOMParser().parseFromString(
        `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body>${h}</body></html>`,
        'text/html'
      );
      const body = doc.body;
      if (!body) return { html: h, updated: false };
      let cur = body;
      for (let i = 0; i < path.length; i += 1) {
        const idx = path[i];
        if (!Number.isFinite(idx) || idx < 0 || idx >= cur.children.length) {
          return { html: h, updated: false };
        }
        cur = cur.children[idx];
      }
      if (cur === body) return { html: h, updated: false };
      cur.textContent = next;
      return { html: body.innerHTML, updated: true };
    } catch (e) {
      return { html: h, updated: false };
    }
  }

  function updateNewsletterNodeTextByTemplateChildPath(html, relPath, text) {
    const h = String(html || '');
    const next = String(text ?? '');
    if (!relPath || !Array.isArray(relPath) || relPath.length === 0) return { html: h, updated: false };
    if (typeof DOMParser === 'undefined') return { html: h, updated: false };
    try {
      const doc = new DOMParser().parseFromString(
        `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body>${h}</body></html>`,
        'text/html'
      );
      const body = doc.body;
      if (!body) return { html: h, updated: false };
      const root = body.querySelector('[data-template-id]');
      if (!root) return { html: h, updated: false };
      let cur = root;
      for (let i = 0; i < relPath.length; i += 1) {
        const idx = relPath[i];
        if (!Number.isFinite(idx) || idx < 0 || idx >= cur.children.length) {
          return { html: h, updated: false };
        }
        cur = cur.children[idx];
      }
      if (cur === root) return { html: h, updated: false };
      cur.textContent = next;
      return { html: body.innerHTML, updated: true };
    } catch (e) {
      return { html: h, updated: false };
    }
  }

  /**
   * Cross-language text sync: prefer path inside [data-template-id], then full body path,
   * then body path with leading indices dropped (same strategy as removeNewsletterNodeByMirrorPath).
   */
  function updateNewsletterNodeTextByMirrorPath(html, pathBody, relPath, text, maxPathSkip = 5) {
    const h = String(html || '');
    const byTpl = updateNewsletterNodeTextByTemplateChildPath(h, relPath, text);
    if (byTpl.updated) return byTpl;
    if (pathBody && pathBody.length) {
      const exact = updateNewsletterNodeTextByBodyChildPath(h, pathBody, text);
      if (exact.updated) return exact;
      const limit = Math.min(maxPathSkip, Math.max(0, pathBody.length - 1));
      for (let skip = 1; skip <= limit; skip += 1) {
        const flex = updateNewsletterNodeTextByBodyChildPath(h, pathBody.slice(skip), text);
        if (flex.updated) return flex;
      }
    }
    return { html: h, updated: false };
  }

  // ── Image src equivalents of the text mirror-path family ──
  // Used by the editor's "Replace image" feature to swap an <img>'s src
  // across every language variant by walking the same DOM path.
  function updateNewsletterNodeImageSrcByBodyChildPath(html, path, newSrc) {
    const h = String(html || '');
    const src = String(newSrc || '');
    if (!path || !Array.isArray(path) || path.length === 0) return { html: h, updated: false };
    if (typeof DOMParser === 'undefined') return { html: h, updated: false };
    try {
      const doc = new DOMParser().parseFromString(
        `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body>${h}</body></html>`,
        'text/html'
      );
      const body = doc.body;
      if (!body) return { html: h, updated: false };
      let cur = body;
      for (let i = 0; i < path.length; i += 1) {
        const idx = path[i];
        if (!Number.isFinite(idx) || idx < 0 || idx >= cur.children.length) {
          return { html: h, updated: false };
        }
        cur = cur.children[idx];
      }
      if (cur === body || !cur || cur.tagName !== 'IMG') return { html: h, updated: false };
      cur.setAttribute('src', src);
      return { html: body.innerHTML, updated: true };
    } catch (e) {
      return { html: h, updated: false };
    }
  }

  function updateNewsletterNodeImageSrcByTemplateChildPath(html, relPath, newSrc) {
    const h = String(html || '');
    const src = String(newSrc || '');
    if (!relPath || !Array.isArray(relPath) || relPath.length === 0) return { html: h, updated: false };
    if (typeof DOMParser === 'undefined') return { html: h, updated: false };
    try {
      const doc = new DOMParser().parseFromString(
        `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body>${h}</body></html>`,
        'text/html'
      );
      const body = doc.body;
      if (!body) return { html: h, updated: false };
      const root = body.querySelector('[data-template-id]');
      if (!root) return { html: h, updated: false };
      let cur = root;
      for (let i = 0; i < relPath.length; i += 1) {
        const idx = relPath[i];
        if (!Number.isFinite(idx) || idx < 0 || idx >= cur.children.length) {
          return { html: h, updated: false };
        }
        cur = cur.children[idx];
      }
      if (cur === root || !cur || cur.tagName !== 'IMG') return { html: h, updated: false };
      cur.setAttribute('src', src);
      return { html: body.innerHTML, updated: true };
    } catch (e) {
      return { html: h, updated: false };
    }
  }

  function updateNewsletterNodeImageSrcByMirrorPath(html, pathBody, relPath, newSrc, maxPathSkip = 5) {
    const h = String(html || '');
    const byTpl = updateNewsletterNodeImageSrcByTemplateChildPath(h, relPath, newSrc);
    if (byTpl.updated) return byTpl;
    if (pathBody && pathBody.length) {
      const exact = updateNewsletterNodeImageSrcByBodyChildPath(h, pathBody, newSrc);
      if (exact.updated) return exact;
      const limit = Math.min(maxPathSkip, Math.max(0, pathBody.length - 1));
      for (let skip = 1; skip <= limit; skip += 1) {
        const flex = updateNewsletterNodeImageSrcByBodyChildPath(h, pathBody.slice(skip), newSrc);
        if (flex.updated) return flex;
      }
    }
    return { html: h, updated: false };
  }

  // ── Generate unique ID ──
  let _idCounter = 0;
  function uid(prefix = 'id') { return `${prefix}_${++_idCounter}_${Date.now().toString(36)}`; }

  // ── Email-safe colour flattening ──
  // Classic Outlook (Word engine) ignores rgba() entirely, so semi-transparent
  // text collapses to black (invisible on dark backgrounds) and tints vanish.
  // We composite each rgba() over its actual rendered backdrop and emit a solid
  // hex — pixel-identical to the rgba in modern clients, but readable in Outlook.
  function _parseOpaqueHex(token) {
    let t = String(token || '').trim().toLowerCase();
    if (t === 'white') t = '#ffffff';
    else if (t === 'black') t = '#000000';
    let m = t.match(/^#([0-9a-f]{6})$/);
    if (m) return { r: parseInt(m[1].slice(0, 2), 16), g: parseInt(m[1].slice(2, 4), 16), b: parseInt(m[1].slice(4, 6), 16) };
    m = t.match(/^#([0-9a-f]{3})$/);
    if (m) return { r: parseInt(m[1][0] + m[1][0], 16), g: parseInt(m[1][1] + m[1][1], 16), b: parseInt(m[1][2] + m[1][2], 16) };
    return null;
  }

  function _hex2(n) { return Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0'); }

  /** Alpha-composite rgba(r,g,b,a) over an opaque hex backdrop → solid '#rrggbb'. */
  function compositeRgbaOverHex(r, g, b, a, bgHex) {
    const bg = _parseOpaqueHex(bgHex) || { r: 255, g: 255, b: 255 };
    const alpha = Math.max(0, Math.min(1, Number(a)));
    const mix = (fg, back) => Number(fg) * alpha + back * (1 - alpha);
    return '#' + _hex2(mix(r, bg.r)) + _hex2(mix(g, bg.g)) + _hex2(mix(b, bg.b));
  }

  function _opaqueHexString(token) {
    const p = _parseOpaqueHex(token);
    return p ? '#' + _hex2(p.r) + _hex2(p.g) + _hex2(p.b) : null;
  }

  /** Opaque background colour declared directly on an element (bgcolor attr, background-color, or hex in background shorthand). */
  function _elementOwnBg(el) {
    if (!el || typeof el.getAttribute !== 'function') return null;
    const attr = el.getAttribute('bgcolor');
    const fromAttr = attr && _opaqueHexString(attr);
    if (fromAttr) return fromAttr;
    const style = el.getAttribute('style') || '';
    let m = style.match(/(?:^|;)\s*background-color\s*:\s*([^;]+)/i);
    if (m) { const h = _opaqueHexString(m[1].trim()); if (h) return h; }
    m = style.match(/(?:^|;)\s*background\s*:\s*([^;]+)/i);
    if (m && !/gradient/i.test(m[1])) {
      const hx = m[1].match(/#[0-9a-f]{3,6}\b/i);
      if (hx) { const h = _opaqueHexString(hx[0]); if (h) return h; }
    }
    return null;
  }

  function _ancestorBg(el, fallback) {
    let p = el && el.parentElement;
    while (p) {
      const h = _elementOwnBg(p);
      if (h) return h;
      p = p.parentElement;
    }
    return fallback;
  }

  /**
   * Rewrite every rgba() in inline styles to a solid hex composited over the
   * element's own (or nearest opaque ancestor's) background. No structural
   * change — only colour values are rewritten. Returns the input unchanged
   * when there is no rgba() or no DOMParser (Node), so it is a safe no-op.
   */
  function flattenEmailColors(html) {
    const raw = String(html || '');
    if (!raw || raw.indexOf('rgba(') === -1) return raw;
    if (typeof DOMParser === 'undefined') return raw;
    const RGBA = /rgba\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*\)/gi;
    try {
      const isFullDoc = /<html[\s>]/i.test(raw);
      const src = isFullDoc
        ? raw
        : `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body>${raw}</body></html>`;
      const doc = new DOMParser().parseFromString(src, 'text/html');
      if (!doc || !doc.body) return raw;
      const FALLBACK = '#ffffff';
      doc.querySelectorAll('[style]').forEach((el) => {
        const style = el.getAttribute('style');
        if (!style || style.indexOf('rgba(') === -1) return;
        const bg = _elementOwnBg(el) || _ancestorBg(el, FALLBACK);
        el.setAttribute('style', style.replace(RGBA, (full, r, g, b, a) => compositeRgbaOverHex(r, g, b, a, bg)));
      });
      if (isFullDoc) {
        const dt = /^\s*<!doctype/i.test(raw) ? '<!DOCTYPE html>' : '';
        return dt + doc.documentElement.outerHTML;
      }
      return doc.body.innerHTML;
    } catch (e) {
      return raw;
    }
  }

  // Outlook's Word engine does NOT inherit font-family into table cells, and
  // resets descendant text of an <a> to its serif default. Any text element
  // that doesn't declare its own font-family falls back to Times New Roman.
  // We stamp an explicit family on every text-bearing element that lacks one.
  // By default an existing font-family is left untouched; pass force=true (used
  // by the email export) to override ANY declared family with the email-safe one,
  // guaranteeing an all-Arial message. Safe no-op without DOMParser or empty input.
  const _EMAIL_FONT_TAGS = new Set([
    'TD', 'TH', 'DIV', 'P', 'SPAN', 'A', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6',
    'LI', 'UL', 'OL', 'B', 'STRONG', 'I', 'EM', 'U', 'FONT', 'CAPTION',
    'TABLE', 'BLOCKQUOTE', 'SMALL', 'LABEL'
  ]);

  function enforceEmailFont(html, family, force) {
    const raw = String(html || '');
    if (!raw) return raw;
    if (typeof DOMParser === 'undefined') return raw;
    const fam = family || 'Arial, Helvetica, sans-serif';
    try {
      const isFullDoc = /<html[\s>]/i.test(raw);
      const src = isFullDoc
        ? raw
        : `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body>${raw}</body></html>`;
      const doc = new DOMParser().parseFromString(src, 'text/html');
      if (!doc || !doc.body) return raw;
      doc.body.querySelectorAll('*').forEach((el) => {
        if (!_EMAIL_FONT_TAGS.has(el.tagName)) return;
        let style = el.getAttribute('style') || '';
        if (/font-family\s*:/i.test(style)) {
          if (!force) return; // preserve the declared family unless force-overriding
          style = style.replace(/font-family\s*:[^;]*;?/ig, '').replace(/\s*;\s*;/g, ';').trim();
        }
        const sep = style && !/;\s*$/.test(style.trim()) ? '; ' : (style ? ' ' : '');
        el.setAttribute('style', `${style}${sep}font-family:${fam};`);
      });
      if (isFullDoc) {
        const dt = /^\s*<!doctype/i.test(raw) ? '<!DOCTYPE html>' : '';
        return dt + doc.documentElement.outerHTML;
      }
      return doc.body.innerHTML;
    } catch (e) {
      return raw;
    }
  }

  return {
    log, clearLog, fmtDate, daysAgo, isWithinDays,
    copyHTML, plainTextFromClipboardHtml, svgsToBase64, inlineCSSVars, buildEmailSafeHTMLFromElement, downloadHTML,
    htmlToSvgExport, downloadSVG, downloadBlob, injectNlQrImageIntoHtml, inlineCidAttachments,
    inlineDataUriAttachments, buildEmlMime, combineHtmlBodies, emlFileName, compositeRgbaOverHex, flattenEmailColors, enforceEmailFont,
    showToast, skeleton, debounce, wait,
    esc, stripTags, truncate, uid, normalizeWebUrl, wireVisitPortalCta, stripGazetteIncidentImageBorder, injectWifiSocCapsule, stripLegacyFooterClassification,
    removeNewsletterNodeByBodyChildPath, removeNewsletterNodeByTemplateChildPath, removeNewsletterNodeByMirrorPath,
    updateNewsletterNodeTextByBodyChildPath, updateNewsletterNodeTextByTemplateChildPath, updateNewsletterNodeTextByMirrorPath,
    updateNewsletterNodeImageSrcByBodyChildPath, updateNewsletterNodeImageSrcByTemplateChildPath, updateNewsletterNodeImageSrcByMirrorPath
  };
})();
