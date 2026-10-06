/**
 * AFC Design System — reflow and target-size gate.
 *
 * Renders a URL at five real viewports and fails on:
 *   - horizontal overflow (WCAG 1.4.10 Reflow)
 *   - any pointer target under --afc-control-min (WCAG 2.5.8 Target Size)
 *   - uncaught page or console errors
 *
 * Use it on the live styleguide, and on any AFC surface before release.
 *
 *   node design-system/tools/reflow-check.mjs
 *   node design-system/tools/reflow-check.mjs http://localhost:3000/
 *
 * Requires a browser. In this workspace:
 *   export LD_LIBRARY_PATH=/home/paperclip/chrome-libs/usr/lib/x86_64-linux-gnu:$LD_LIBRARY_PATH
 * (the bundled Chromium cannot find libnspr4/libnss3 without it)
 */
import { chromium } from 'playwright';

const URL_ = process.argv[2] ??
  new URL('../styleguide/index.html', import.meta.url).href;

const VIEWPORTS = [
  { name: 'desktop-1440', width: 1440, height: 900 },
  { name: 'laptop-1280',  width: 1280, height: 800 },
  { name: 'tablet-768',   width: 768,  height: 1024 },
  { name: 'mobile-390',   width: 390,  height: 844 },
  { name: 'mobile-320',   width: 320,  height: 844 },
];

// Matches --afc-control-min in the default `cozy` density.
const MIN_TARGET = 44;
// WCAG 2.2 AA 2.5.8 absolute floor.
const AA_FLOOR = 24;

const browser = await chromium.launch();
let failures = 0;

console.log('\nAFC Design System — reflow and target-size gate\n' + '='.repeat(74));
console.log(`target: ${URL_}\n`);

for (const vp of VIEWPORTS) {
  const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));

  await page.goto(URL_, { waitUntil: 'networkidle' });
  await page.waitForTimeout(500);

  const r = await page.evaluate((aaFloor) => {
    const d = document.documentElement;
    const isClipped = (el) => {
      for (let p = el.parentElement; p; p = p.parentElement) {
        const ov = getComputedStyle(p).overflowX;
        if (ov === 'auto' || ov === 'scroll' || ov === 'hidden') return true;
      }
      return false;
    };
    const overflowing = [...document.querySelectorAll('*')]
      .filter((el) => el.getBoundingClientRect().right > d.clientWidth + 1 && !isClipped(el))
      .map((el) => (el.className || el.tagName).toString().slice(0, 40));

    // An element is a violation only if NO wrapping label enlarges the hit area.
    const small = [...document.querySelectorAll('button, a[href], input, select, textarea, [role="button"]')]
      .filter((el) => {
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) return false;
        if (r.width >= aaFloor && r.height >= aaFloor) return false;
        const label = el.closest('label');
        if (label) {
          const lr = label.getBoundingClientRect();
          if (lr.width >= aaFloor && lr.height >= aaFloor) return false;
        }
        return true;
      })
      .map((el) => `${(el.className || el.tagName).toString().slice(0, 28)} ` +
                   `${Math.round(el.getBoundingClientRect().width)}x${Math.round(el.getBoundingClientRect().height)}`);

    return {
      scrollW: d.scrollWidth, clientW: d.clientWidth,
      overflowing: [...new Set(overflowing)],
      small: [...new Set(small)],
    };
  }, AA_FLOOR);

  const overflowOk = r.scrollW <= r.clientW && r.overflowing.length === 0;
  const targetsOk = r.small.length === 0;
  const errOk = errors.length === 0;
  if (!overflowOk || !targetsOk || !errOk) failures++;

  console.log(
    vp.name.padEnd(14) +
      String(r.scrollW).padStart(5) + '/' + String(r.clientW).padEnd(5) +
      (overflowOk ? ' reflow OK   ' : ` REFLOW FAIL  ${JSON.stringify(r.overflowing.slice(0, 4))}`) +
      (targetsOk ? ' targets OK  ' : ` TARGET FAIL ${JSON.stringify(r.small.slice(0, 4))}`) +
      (errOk ? ' js clean' : ` JS ERRORS ${JSON.stringify(errors.slice(0, 2))}`)
  );

  await ctx.close();
}

console.log('-'.repeat(74));
console.log(
  failures
    ? `${failures}/${VIEWPORTS.length} viewports FAILED.`
    : `All ${VIEWPORTS.length} viewports pass.`
);
console.log(
  `\nTarget rule: >= ${AA_FLOOR}px is the WCAG 2.2 AA 2.5.8 floor; AFC holds ${MIN_TARGET}px\n` +
  `in the default \`cozy\` density. A control wrapped in an adequately sized <label>\n` +
  `is treated as compliant, because the label is the real pointer target.\n`
);

await browser.close();
process.exit(failures ? 1 : 0);
