/**
 * AFC-957 — P6 gate for the Portal resilient-state prototypes.
 *
 * Checks every prototype in docs/prototypes/afc-957/ at desktop (1440x900)
 * and mobile (390x844) for:
 *   - horizontal overflow (WCAG 1.4.10 Reflow)
 *   - pointer targets below the 44px cozy default (WCAG 2.5.8)
 *   - axe-core WCAG 2.x serious/critical violations
 *   - page / console errors
 *
 * Usage (serve the repo over HTTP so token CSS can be fetched):
 *   python3 -m http.server 8899 --bind 127.0.0.1 &
 *   node docs/prototypes/afc-957/tools/p6-state-gate.mjs http://127.0.0.1:8899
 *
 * Requires playwright + axe-core. The afc-portal app does not ship them at
 * the repo root today; run from a checkout that has them resolvable
 * (see docs/prototypes/afc-957/README.md for the exact run used).
 */
import { chromium } from 'playwright';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../../../..');
const DIR = 'docs/prototypes/afc-957';
const BASE = process.argv[2] ?? 'http://127.0.0.1:8899';

const screens = [
  ['P1 registration-form', 'registration-form.html'],
  ['P2+P5 attendance-capture', 'attendance-capture.html'],
  ['P2 newcomer-intake', 'newcomer-intake.html'],
  ['P2 welfare-visit-notes', 'welfare-visit-notes.html'],
  ['P2 sync-settings', 'sync-settings.html'],
  ['P5 finance-export', 'finance-export.html'],
  ['P4 events', 'events.html'],
  ['P4 welfare-cases', 'welfare-cases.html'],
  ['P4 campus-groups', 'campus-groups.html'],
  ['P4 reports', 'reports.html'],
];

const viewports = [
  ['desktop-1440', 1440, 900],
  ['mobile-390', 390, 844],
];

const axeSrc = readFileSync(resolve(root, 'node_modules/axe-core/axe.min.js'), 'utf8');

const browser = await chromium.launch();
let fail = 0;

console.log(`\nAFC-957 P6 gate — ${screens.length} screens x ${viewports.length} viewports`);
console.log('='.repeat(74));

for (const [label, file] of screens) {
  if (!existsSync(resolve(root, DIR, file))) {
    console.log(`MISSING ${label}: ${file}`);
    fail++;
    continue;
  }
  for (const [vp, width, height] of viewports) {
    const ctx = await browser.newContext({ viewport: { width, height } });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e).slice(0, 120)));
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text().slice(0, 120));
    });

    await page.goto(`${BASE}/${DIR}/${file}`, { waitUntil: 'load' });
    await page.waitForTimeout(250);

    const overflow = await page.evaluate(() => window.document.documentElement.scrollWidth - window.innerWidth);

    await page.addScriptTag({ content: axeSrc });
    const axe = await page.evaluate(async () => {
      const r = await window.axe.run(window.document, {
        runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] },
      });
      return r.violations
        .filter((v) => ['serious', 'critical'].includes(v.impact))
        .map((v) => ({ id: v.id, nodes: v.nodes.length }));
    });

    const small = await page.evaluate(() => {
      const sel = 'a[href], button, input, select, textarea, [role="button"], [tabindex]:not([tabindex="-1"])';
      let n = 0;
      const out = [];
      for (const el of window.document.querySelectorAll(sel)) {
        const r = el.getBoundingClientRect();
        if (r.width === 0 && r.height === 0) continue;
        if (el.closest('label')) continue;
        if (el.type === 'hidden') continue;
        if (r.width < 44 || r.height < 44) {
          n++;
          if (out.length < 3) out.push(`${el.tagName}.${el.className}`.slice(0, 60) + ` ${Math.round(r.width)}x${Math.round(r.height)}`);
        }
      }
      return { n, out };
    });

    const bad = overflow > 1 || axe.length > 0 || small.n > 0 || errors.length > 0;
    if (bad) fail++;
    console.log(
      `${bad ? 'FAIL' : 'PASS'}  ${label.padEnd(24)} ${vp.padEnd(12)} overflow=${overflow} targets<44=${small.n} axe=${axe.length} jsErr=${errors.length}`,
    );
    for (const a of axe) console.log(`      axe ${a.id} x${a.nodes}`);
    for (const s of small.out) console.log(`      small ${s}`);
    for (const e of errors.slice(0, 2)) console.log(`      err ${e}`);
    await ctx.close();
  }
}

await browser.close();
console.log(fail === 0 ? '\nP6 GATE: PASS (all screens, both viewports)' : `\nP6 GATE: ${fail} failing screen/viewport combinations`);
process.exit(fail === 0 ? 0 : 1);
