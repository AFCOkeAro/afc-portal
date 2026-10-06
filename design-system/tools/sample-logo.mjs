#!/usr/bin/env node
/**
 * AFC Design System — logo colour sampler.
 *
 * Every colour quoted in tokens/afc-tokens.css or logos/README.md must be
 * sampled from the pixels of a named file, never eyeballed. This is the tool
 * that does the sampling, so the claim is reproducible by anyone.
 *
 *   node design-system/tools/sample-logo.mjs design-system/logos/*.png
 *   node design-system/tools/sample-logo.mjs --transparent-tol 8 logo.png
 *
 * Output per file: dimensions, alpha statistics, and the top colours by pixel
 * coverage with hex, RGB, coverage %, and HSL. Flat colours and JPEG ringing
 * produce many near-identical bins; bins are therefore merged by rounding to a
 * 12-bit grid before counting, and the reported hex is the mean of its bin.
 *
 * Requires a browser. In this workspace:
 *   export LD_LIBRARY_PATH=/home/paperclip/chrome-libs/usr/lib/x86_64-linux-gnu:$LD_LIBRARY_PATH
 */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';

const argv = process.argv.slice(2);
let tol = 4; // quantise each channel to this many steps before binning
const files = [];
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--transparent-tol') tol = Number(argv[++i]);
  else files.push(argv[i]);
}
if (!files.length) {
  console.error('usage: node tools/sample-logo.mjs [--transparent-tol N] <image>...');
  process.exit(2);
}

const browser = await chromium.launch();
const page = await browser.newPage();

console.log('\nAFC Design System — logo colour sampler\n' + '='.repeat(78));
console.log(`quantise step: ${tol}/255   (larger merges JPEG ringing)\n`);

for (const file of files) {
  const b64 = readFileSync(file).toString('base64');
  const mime = /\.png$/i.test(file) ? 'image/png' : /\.webp$/i.test(file) ? 'image/webp' : 'image/jpeg';

  const r = await page.evaluate(async ({ b64, mime, tol }) => {
    const img = new Image();
    img.src = `data:${mime};base64,${b64}`;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = img.naturalWidth;
    c.height = img.naturalHeight;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0);
    const { data } = ctx.getImageData(0, 0, c.width, c.height);

    const step = Math.max(1, Math.round(tol));
    const bins = new Map();
    let transparent = 0;
    let opaque = 0;
    let partial = 0;
    let minA = 255;
    let maxA = 0;

    for (let i = 0; i < data.length; i += 4) {
      const a = data[i + 3];
      if (a < minA) minA = a;
      if (a > maxA) maxA = a;
      if (a === 0) { transparent++; continue; }
      if (a < 250) partial++;
      opaque++;
      // Composite onto white so a transparent PNG reports what it looks like
      // on the paper surface, which is the surface it will actually sit on.
      const k = a / 255;
      const r = Math.round((data[i] * k + 255 * (1 - k)) / step) * step;
      const g = Math.round((data[i + 1] * k + 255 * (1 - k)) / step) * step;
      const b = Math.round((data[i + 2] * k + 255 * (1 - k)) / step) * step;
      const key = (r << 16) | (g << 8) | b;
      const bin = bins.get(key) ?? { n: 0, r: 0, g: 0, b: 0 };
      bin.n++; bin.r += r; bin.g += g; bin.b += b;
      bins.set(key, bin);
    }

    const rgb2hsl = (r, g, b) => {
      r /= 255; g /= 255; b /= 255;
      const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
      let h = 0;
      if (d) {
        if (mx === r) h = ((g - b) / d) % 6;
        else if (mx === g) h = (b - r) / d + 2;
        else h = (r - g) / d + 4;
        h *= 60;
        if (h < 0) h += 360;
      }
      const l = (mx + mn) / 2;
      const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
      return [Math.round(h), +s.toFixed(2), +l.toFixed(2)];
    };

    const total = opaque + transparent;
    const top = [...bins.values()]
      .sort((a, b) => b.n - a.n)
      .slice(0, 8)
      .map((bin) => {
        const r = Math.round(bin.r / bin.n), g = Math.round(bin.g / bin.n), bl = Math.round(bin.b / bin.n);
        const hex = '#' + [r, g, bl].map((v) => v.toString(16).padStart(2, '0')).join('').toUpperCase();
        const [h, s, l] = rgb2hsl(r, g, bl);
        return { hex, rgb: `${r},${g},${bl}`, pct: +((bin.n / total) * 100).toFixed(2), h, s, l };
      });

    return {
      w: c.width, h: c.height,
      alpha: { minA, maxA, transparentPct: +((transparent / (data.length / 4)) * 100).toFixed(1),
               partialPct: +((partial / total) * 100).toFixed(1), opaquePct: +((opaque / total) * 100).toFixed(1) },
      top,
    };
  }, { b64, mime, tol });

  console.log('-'.repeat(78));
  console.log(`${basename(file)}   ${r.w} x ${r.h}`);
  console.log(
    `  alpha  min=${r.alpha.minA} max=${r.alpha.maxA}  ` +
    `transparent ${r.alpha.transparentPct}%  partial ${r.alpha.partialPct}%  opaque ${r.alpha.opaquePct}%` +
    (r.alpha.transparentPct > 0 ? '   -> has a transparent background' : '')
  );
  console.log('  colour          rgb            cover%   H     S     L');
  for (const c of r.top) {
    console.log(
      `  ${c.hex}      ${c.rgb.padEnd(13)} ${String(c.pct).padStart(6)}` +
      `  ${String(c.h).padStart(3)}  ${c.s.toFixed(2).padStart(5)}  ${c.l.toFixed(2).padStart(5)}`
    );
  }
}

console.log('-'.repeat(78));
console.log(
  '\nTransparent pixels are composited onto white, so a colour here is what the\n' +
  'mark looks like on paper. Sampled hue is reported to make a family judgement\n' +
  'checkable: 210-260 blue/violet, 260-290 purple, 290-340 magenta, 340-20 red,\n' +
  '20-45 orange, 45-70 yellow, 70-160 green, 160-200 cyan, 200-250 blue.\n'
);

await browser.close();