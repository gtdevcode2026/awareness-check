// Rasterize the 4 Vishing icon badges (gold circle + black line-icon) to PNG.
//
// Why: the source poster draws these as inline <svg>. Inline SVG renders blank
// in Outlook and Gmail, so for an EMAIL-safe template the icons must be raster
// <img>. We render the exact same SVGs (lifted from the standalone poster) to
// transparent PNGs at 2x for crispness, then embed them via the asset bundle.
//
//   npm run build:vishing-icons   (then: npm run build:template-assets)

import { chromium } from 'playwright';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'assets');
const RING = 'fill="#FFFFFF" stroke="#C09010" stroke-width="3"';

// id -> inner shapes (the gold ring is shared). viewBox 0 0 64 64.
const ICONS = {
  vishing_ico_time:
    `<circle cx="32" cy="32" r="30" ${RING}/><path d="M32 15a13 13 0 0 0-8 23.3c1.4 1.1 2.3 2.7 2.3 4.4V44h11.4v-1.3c0-1.7.9-3.3 2.3-4.4A13 13 0 0 0 32 15z" fill="#0A0A0A"/><rect x="27" y="46" width="10" height="4" rx="1.5" fill="#0A0A0A"/><rect x="28.5" y="51" width="7" height="3" rx="1.5" fill="#0A0A0A"/>`,
  vishing_ico_emotion:
    `<circle cx="32" cy="32" r="30" ${RING}/><circle cx="32" cy="26" r="8.5" fill="#0A0A0A"/><path d="M16 49c0-8.6 7.2-14 16-14s16 5.4 16 14z" fill="#0A0A0A"/><rect x="22" y="22" width="20" height="5" rx="2.5" fill="#FFFFFF"/>`,
  vishing_ico_verify:
    `<circle cx="32" cy="32" r="30" ${RING}/><circle cx="29" cy="29" r="9.5" fill="none" stroke="#0A0A0A" stroke-width="4"/><line x1="36" y1="36" x2="46" y2="46" stroke="#0A0A0A" stroke-width="5" stroke-linecap="round"/>`,
  vishing_ico_context:
    `<circle cx="32" cy="32" r="30" ${RING}/><rect x="24" y="15" width="16" height="34" rx="3.5" fill="none" stroke="#0A0A0A" stroke-width="3"/><line x1="29" y1="44" x2="35" y2="44" stroke="#0A0A0A" stroke-width="3" stroke-linecap="round"/>`,
};

const SIZE = 124; // 62px @ 2x

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: SIZE, height: SIZE } });
  for (const [name, inner] of Object.entries(ICONS)) {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 64 64">${inner}</svg>`;
    await page.setContent(`<!DOCTYPE html><body style="margin:0">${svg}</body>`, { waitUntil: 'load' });
    const buf = await page.locator('svg').screenshot({ omitBackground: true });
    await writeFile(path.join(OUT, name + '.png'), buf);
    console.log(`Wrote assets/${name}.png (${SIZE}x${SIZE})`);
  }
} finally {
  await browser.close();
}
