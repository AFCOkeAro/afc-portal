#!/usr/bin/env node
/**
 * AFC Design System — contrast gate.
 *
 * Verifies every foreground/background pair declared in tokens/afc-tokens.css
 * against WCAG 2.2 thresholds. Exits non-zero on any failure, so this can run
 * in CI and block a token change that would ship an inaccessible pair.
 *
 *   node design-system/tools/contrast-check.mjs
 *
 * Pair list lives in tools/pairs.json so designers can extend coverage without
 * touching this script. Any pair added there is enforced.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));

/* ---------- WCAG relative luminance + contrast ---------- */
const srgb = (hex) => {
  const h = hex.replace('#', '').trim();
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  if (!/^[0-9a-f]{6}$/i.test(full)) throw new Error(`bad hex: ${hex}`);
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16) / 255);
};
const lum = (hex) =>
  srgb(hex)
    .map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
    .reduce((acc, c, i) => acc + c * [0.2126, 0.7152, 0.0722][i], 0);
export const contrast = (a, b) => {
  const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m);
  return (x + 0.05) / (y + 0.05);
};

/** Flatten rgba() over an opaque backdrop so a 32%-white border is graded at
 *  its real effective value instead of being silently skipped. */
const composite = (rgba, bgHex) => {
  const [r, g, b] = rgba.slice(1, 4).map(Number);
  const a = rgba.length > 4 ? Number(rgba[4]) : 1;
  const bg = srgb(bgHex).map((c) => c * 255);
  const out = [r, g, b].map((c, i) => c * a + bg[i] * (1 - a));
  return '#' + out.map((c) => Math.round(c).toString(16).padStart(2, '0')).join('');
};

/* ---------- load token values out of the CSS source ---------- */
const cssRaw = readFileSync(join(here, '..', 'tokens', 'afc-tokens.css'), 'utf8');
const css = cssRaw.replace(/\/\*[\s\S]*?\*\//g, ''); // comments carry provenance, not values

/** Grab the balanced `{...}` body that follows a literal selector. */
function blockBody(selector) {
  const at = css.indexOf(selector + ' {');
  if (at === -1) throw new Error(`selector not found in afc-tokens.css: ${selector}`);
  let depth = 0;
  for (let i = css.indexOf('{', at); i < css.length; i++) {
    if (css[i] === '{') depth++;
    else if (css[i] === '}') {
      depth--;
      if (depth === 0) return css.slice(css.indexOf('{', at) + 1, i);
    }
  }
  throw new Error(`unbalanced braces after ${selector}`);
}

/** selector -> { token: rawValue }. Later declarations win (cascade-faithful). */
function decls(body) {
  const out = {};
  for (const d of body.split(';')) {
    const m = d.match(/--([a-z0-9-]+)\s*:\s*([^;]+)/i);
    if (m) out[m[1]] = m[2].trim();
  }
  return out;
}

const blocks = {
  ':root': decls(blockBody(':root')),
  "[data-theme='dark']": decls(blockBody("[data-theme='dark']")),
};

/** Resolve --name, following var() chains until a hex literal is reached. */
const tokenValue = (name, scope = ':root') => {
  // Scoped blocks redefine primitives rarely; fall back to :root like the cascade.
  const raw = blocks[scope]?.[name] ?? (scope !== ':root' ? blocks[':root']?.[name] : undefined);
  if (raw === undefined) {
    throw new Error(
      `token not found: --${name}${scope !== ':root' ? ` in ${scope}` : ''}. ` +
        `Available selectors: ${Object.keys(blocks).join(' | ')}`
    );
  }
  const ref = raw.match(/^var\(\s*--([a-z0-9-]+)\s*(?:,|\))/i);
  if (ref) return tokenValue(ref[1], scope);
  const hex = raw.match(/^#([0-9a-fA-F]{3,8})$/);
  if (hex) return '#' + hex[1];
  // Translucent tokens (dark-theme borders) only mean something composited over
  // a real surface, so the caller flattens them onto pair.bg.
  const rgba = raw.match(/^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/i);
  if (rgba) return rgba;
  throw new Error(`--${name} resolves to "${raw}", which is neither hex, var() nor rgba().`);
};

/* ---------- pairs under test ---------- */
const pairs = JSON.parse(readFileSync(join(here, 'pairs.json'), 'utf8'));

/* WCAG 2.2 thresholds */
const AA_BODY = 4.5; // 1.4.3 Contrast (Minimum), normal text
const AA_LARGE = 3.0; // 1.4.3, >=24px or >=18.66px bold
const AAA_BODY = 7.0; // 1.4.6
const NONTEXT = 3.0; // 1.4.11 Non-text Contrast (focus ring, borders, icons)
const TARGET_MIN = 24; // 2.5.8 Target Size (Minimum), CSS px

let failures = 0;
let rows = 0;

const DARK = "[data-theme='dark']";
const scopeNote = (p) => (p.scope === DARK ? '  (dark)' : '');

console.log('\nAFC Design System — contrast gate\n' + '='.repeat(78));
console.log(
  'surface'.padEnd(22) +
    'fg'.padEnd(22) +
    'ratio'.padStart(7) +
    '  need'.padStart(7) +
    '  size'.padStart(6) +
    '  verdict'
);
console.log('-'.repeat(78));

for (const p of pairs) {
  const scope = p.scope || ':root';
  const bg = tokenValue(p.bg, scope);
  const fgRaw = tokenValue(p.fg, scope);
  const fg = Array.isArray(fgRaw) ? composite(fgRaw, bg) : fgRaw;
  const ratio = contrast(fg, bg);
  const need = p.role === 'non-text' ? NONTEXT : p.large ? AA_LARGE : AA_BODY;
  const size = p.px ?? 16;
  const ok = ratio >= need;
  if (!ok) failures++;
  rows++;
  console.log(
    (p.surface || `${p.fg} on ${p.bg}`).slice(0, 21).padEnd(22) +
      `--${p.fg}`.slice(0, 21).padEnd(22) +
      `${ratio.toFixed(2)}:1`.padStart(7) +
      `${need.toFixed(1)}:1`.padStart(7) +
      `${size}px`.padStart(6) +
      '  ' +
      (ok ? 'PASS' : 'FAIL') +
      (scopeNote(p))
  );
}

console.log('-'.repeat(78));
console.log(
  `${rows - failures}/${rows} pairs pass. ` +
    (failures ? `${failures} FAILING.` : 'No failures.')
);
console.log(
  `\nTarget size floor: ${TARGET_MIN}px (WCAG 2.2 AA 2.5.8). Enforced in afc-components.css\n` +
    `via --afc-control-min and asserted in docs/ACCESSIBILITY.md.\n`
);

process.exit(failures ? 1 : 0);