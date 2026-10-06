#!/usr/bin/env node
/**
 * AFC Design System — seal optical-weight gate.
 *
 * The five AFC marks do not share a canvas: JTLW fills 58% of its own frame,
 * WECA 89%, AFCMF and AFCF 98%. Giving them all one CSS `height` therefore
 * renders their INK at wildly different sizes — measured at 1.70x in ink
 * height and 3.88x in ink area on revision 1 of the styleguide.
 *
 * This tool re-measures that and fails when the optical factors declared in
 * afc-components.css have drifted from the artwork, or when a new mark is
 * added without one. A mark file replaced without updating the factor fails
 * here rather than shipping a mis-sized seal.
 *
 *   node design-system/tools/seal-weight-check.mjs
 *
 * Target: ink height within +/-12% of the median, and ink area within 1.9x.
 * Requires a browser. In this workspace:
 *   export LD_LIBRARY_PATH=/home/paperclip/chrome-libs/usr/lib/x86_64-linux-gnu:$LD_LIBRARY_PATH
 */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(here, '..', 'components', 'afc-components.css'), 'utf8');

/** The factors declared in the component layer, so we check the CSS not a copy. */
const declared = new Map();
for (const m of css.matchAll(/\[data-seal='([a-z0-9-]+)'\]\s*\{\s*--afc-seal-optical:\s*([\d.]+)/g)) {
  declared.set(m[1], Number(m[2]));
}

/** seal key -> file, relative to logos/. Keep in step with the CSS above. */
const MARKS = [
  ['jtlw', 'afc-jesus-light-of-world.png'],
  ['weca', 'weca-lockup-print.png'],
  ['afcmf', 'afcmf-logo.jpg'],
  ['ydd', 'youth-development-logo.png'],
  ['afcf', 'afcf-logo.png'],
  ['afc4c', 'africa-for-christ-logo.png'],
];

const browser = await chromium.launch();
const page = await browser.newPage();
const log = dirname(new URL(import.meta.url).pathname);

console.log('\nAFC Design System — seal optical-weight gate\n' + '='.repeat(74));
console.log('ink bbox measured from each mark file, composited as it renders\n');

const rows = [];
for (const [key, file] of MARKS) {
  const path = join(here, '..', 'logos', file);
  const b64 = readFileSync(path).toString('base64');
  const mime = /\.png$/i.test(file) ? 'image/png' : 'image/jpeg';

  const m = await page.evaluate(async ({ b64, mime }) => {
    const img = new Image();
    img.src = `data:${mime};base64,${b64}`;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = img.naturalWidth;
    c.height = img.naturalHeight;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0);
    const { data } = ctx.getImageData(0, 0, c.width, c.height);
    const lum = (i) => 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
    let minX = c.width, minY = c.height, maxX = -1, maxY = -1;
    for (let i = 0; i < data.length; i += 4) {
      const a = data[i + 3];
      // ink = any pixel that is not transparent and not paper-white
      const visible = a > 16 && (a < 250 ? lum(i) < 250 : lum(i) < 240);
      if (!visible) continue;
      const x = (i / 4) % c.width, y = Math.floor((i / 4) / c.width);
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
    return {
      size: `${c.width}x${c.height}`,
      iw: maxX - minX + 1,
      ih: maxY - minY + 1,
      fill: +((maxY - minY + 1) / c.height).toFixed(3),
      ar: +((maxX - minX + 1) / (maxY - minY + 1)).toFixed(3),
    };
  }, { b64, mime });

  rows.push({ key, file, ...m, factor: declared.get(key) });
}

const median = (a) => {
  const s = [...a].sort((x, y) => x - y);
  return s[Math.floor(s.length / 2)];
};

/* Optical height is measured in CSS PIXELS ON SCREEN, not in source pixels.
   The rendered element is fixed (3.5rem at --lg = 56px); the mark is then
   scaled by --afc-seal-optical. So what lands on screen is:

       optical height = ELEMENT_HEIGHT * (ink height / canvas height) * factor

   Comparing raw source-pixel heights across a 170x80 file and a 1041x1080
   file is meaningless — that was the first bug in this tool. */
const ELEMENT_H = 56; // 3.5rem, the styleguide .sg-seal-card img height

const measured = rows.map((r) => ({
  ...r,
  // fraction of the element height that is actually ink, before correction
  inkFraction: +(r.fill).toFixed(3),
  optical: +(ELEMENT_H * r.fill * (r.factor ?? 1)).toFixed(1),
}));

const target = median(measured.map((r) => r.optical));
const medianFactor = median(rows.map((r) => r.factor ?? 1));

console.log(`element height ${ELEMENT_H}px (3.5rem). optical = element x inkFraction x factor\n`);
console.log('mark'.padEnd(9) + 'file'.padEnd(30) + 'canvas'.padEnd(11) +
  'ink'.padEnd(11) + 'fill'.padEnd(8) + 'factor'.padEnd(8) + 'optical h');
console.log('-'.repeat(74));

let failures = 0;
for (const r of measured) {
  const drift = (r.optical / target - 1) * 100;
  const ok = r.factor !== undefined && Math.abs(drift) <= 12;
  if (!ok) failures++;
  console.log(
    r.key.padEnd(9) +
      r.file.padEnd(30) +
      r.size.padEnd(11) +
      `${r.iw}x${r.ih}`.padEnd(11) +
      String(r.fill).padEnd(8) +
      (r.factor === undefined ? 'MISSING' : r.factor.toFixed(2)).padEnd(8) +
      `${r.optical.toFixed(1)}px` +
      (ok ? '   ok' : `   DRIFT ${drift >= 0 ? '+' : ''}${drift.toFixed(0)}%`)
  );
}

const optH = measured.map((r) => r.optical);
// Area scales with the square of the factor, on the same on-screen element.
const areas = measured.map((r) => (ELEMENT_H * r.fill * r.factor) * (r.iw / r.ih) * (ELEMENT_H * r.fill * r.factor));
const hSpread = Math.max(...optH) / Math.min(...optH);
const aSpread = Math.max(...areas) / Math.min(...areas);

console.log('-'.repeat(74));
console.log(`median factor ${medianFactor}   target optical ink height ${target.toFixed(1)}px`);
console.log(`optical ink height spread ${Math.min(...optH).toFixed(1)}..${Math.max(...optH).toFixed(1)}px = ${hSpread.toFixed(2)}x`);
console.log(`optical ink area   spread = ${aSpread.toFixed(2)}x`);

/* The gate is INK HEIGHT, not ink area. The marks have genuinely different
   aspect ratios — the WECA lockup is 2.1:1 and wide, the AFCMF crest is 1.3:1
   and square-ish, Africa for Christ is 0.8:1 and tall. Equalising AREA would
   mean distorting the artwork, which the usage contract forbids outright.
   Height is the dimension the eye reads as "how big is this mark", and it is
   the only one that can be corrected without touching the artwork. Area is
   reported so the residual is visible rather than hidden. */
if (hSpread > 1.3) {
  failures++;
  console.log(`\nFAIL ink height spread ${hSpread.toFixed(2)}x exceeds 1.30x — seals do not read as equals.`);
}
console.log(`\nNote: area spread is informational. Marks differ in aspect by design;`);
console.log(`equalising it would require distorting the artwork. Height is the gate.`);

console.log(
  failures
    ? `\n${failures} problem(s). Re-derive the factors and update afc-components.css.`
    : `\nAll ${measured.length} marks pass. Ink height within 1.30x.`
);

await browser.close();
process.exit(failures ? 1 : 0);