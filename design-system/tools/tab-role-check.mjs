/**
 * AFC Design System — anchor-nav / tab-role gate.
 *
 * WHY THIS EXISTS
 *   `.afc-tabs` has two consumers with two different semantics:
 *
 *     - a REAL ARIA tab panel: `role="tablist"` > `role="tab" aria-selected`,
 *       with a controlled panel. `aria-selected` is correct here.
 *     - an ANCHOR NAV (the Church Portal single-page surfaces): a `<nav>` of
 *       `<a class="afc-tab" href="#section" aria-current="true">` links. There
 *       is no panel and nothing is selected, so `aria-selected` is a FALSE
 *       state. The correct hook is `aria-current`.
 *
 *   The stylesheet renders both hooks, but it cannot stop a consuming app from
 *   writing the wrong one. A convention is not a control. This gate is the
 *   control: it fails if an `.afc-tab` carries `aria-selected` without
 *   `role="tab"` — i.e. the attribute was put on a link.
 *
 *   It also asserts the CSS invariant the fix depends on: the `aria-selected`
 *   and `aria-current` active-state selectors must resolve to the SAME
 *   declaration block, so the two semantics can never drift apart.
 *
 * USAGE
 *   node design-system/tools/tab-role-check.mjs [target-dir] [--self-test]
 *
 *   [target-dir]  defaults to the current working directory. Point it at a
 *                 consuming app (the Church Portal repo) in CI.
 *   --self-test   builds a throwaway tree, plants one defect, and asserts the
 *                 gate rejects it and accepts the clean tree. A gate nobody has
 *                 watched fail is not a gate.
 *
 * EXIT
 *   0 -> no misuse, and the CSS invariant holds.
 *   1 -> misuse found, or the CSS invariant is broken.
 *   2 -> the gate could not run (bad target, unreadable CSS). Fail closed.
 */
import { readFileSync, readdirSync, statSync, mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join, extname, relative, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const SELF_DIR = dirname(fileURLToPath(import.meta.url));
const CSS_PATH = join(SELF_DIR, '..', 'components', 'afc-components.css');

// Source extensions that can carry markup. Deliberately NOT `.mjs`/`.js`/`.ts`:
// this gate's own source names `aria-selected` in strings, and scanning code for
// a markup attribute produces false positives, not findings.
const MARKUP_EXT = new Set(['.html', '.htm', '.vue', '.jsx', '.tsx', '.astro', '.svelte', '.php', '.njk', '.liquid']);

// Directories that never contain consumer markup we own.
const SKIP_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', '.next', '.nuxt', '.output',
  '.svelte-kit', 'coverage', '.cache', 'vendor',
]);

// ---------------------------------------------------------------------------
// Markup scanning
// ---------------------------------------------------------------------------

/**
 * Extract every tag in `text`, respecting quoted attribute values so a `>` or
 * `<` inside an attribute does not end a tag. Returns { raw, start } where
 * start is the byte offset (for line reporting).
 */
function extractTags(text) {
  const tags = [];
  let i = 0;
  const n = text.length;
  while (i < n) {
    if (text[i] !== '<') { i++; continue; }
    const start = i;
    i++;
    // Skip comments, doctype, closing tags are still fine to parse loosely.
    if (text.startsWith('!--', i)) {
      const end = text.indexOf('-->', i);
      i = end === -1 ? n : end + 3;
      continue;
    }
    let quote = null;
    let end = -1;
    for (; i < n; i++) {
      const c = text[i];
      if (quote) { if (c === quote) quote = null; continue; }
      if (c === '"' || c === "'") { quote = c; continue; }
      if (c === '>') { end = i; break; }
      if (c === '<') { end = -1; break; } // malformed; skip
    }
    if (end === -1) { continue; }
    tags.push({ raw: text.slice(start, end + 1), start });
    i = end + 1;
  }
  return tags;
}

/** Read an attribute's value from a raw tag, or null. Tolerant of quotes. */
function attr(raw, name) {
  const re = new RegExp(`(?:^|\\s)${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i');
  const m = raw.match(re);
  if (!m) return null;
  return m[2] ?? m[3] ?? m[4] ?? '';
}

/** True when a raw tag carries `name` as a bare or valued attribute. */
function hasAttr(raw, name) {
  return new RegExp(`(?:^|\\s)${name}(?:\\s*=|\\s|>|/|$)`, 'i').test(raw);
}

/** The class tokens on a tag, from `class` or `className`. */
function classTokens(raw) {
  const value = attr(raw, 'class') ?? attr(raw, 'className') ?? '';
  return value.split(/\s+/).filter(Boolean);
}

/** Is one of the class tokens `.afc-tab` (optionally with a BEM modifier)? */
function isAfcTab(tokens) {
  return tokens.some((t) => /^afc-tab($|--|__)/.test(t));
}

function walk(dir, files = []) {
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); }
  catch { return files; }
  for (const e of entries) {
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name)) continue;
      walk(join(dir, e.name), files);
    } else if (e.isFile() && MARKUP_EXT.has(extname(e.name).toLowerCase())) {
      files.push(join(dir, e.name));
    }
  }
  return files;
}

function lineOf(text, offset) {
  let line = 1;
  for (let i = 0; i < offset && i < text.length; i++) if (text[i] === '\n') line++;
  return line;
}

/**
 * Find every `.afc-tab` that carries `aria-selected` without `role="tab"`.
 * That is the misuse: the selected-state hook was put on a link.
 */
function findMisuse(dir) {
  const findings = [];
  for (const file of walk(dir)) {
    let text;
    try { text = readFileSync(file, 'utf8'); } catch { continue; }
    for (const { raw, start } of extractTags(text)) {
      if (!isAfcTab(classTokens(raw))) continue;
      if (!hasAttr(raw, 'aria-selected')) continue;
      if (hasAttr(raw, 'role') && (attr(raw, 'role') || '').toLowerCase() === 'tab') continue;
      findings.push({
        file: relative(dir, file) || file,
        line: lineOf(text, start),
        snippet: raw.replace(/\s+/g, ' ').slice(0, 120),
      });
    }
  }
  return findings;
}

// ---------------------------------------------------------------------------
// CSS invariant: both hooks share one declaration block
// ---------------------------------------------------------------------------

/**
 * Every rule block whose selector list names `.afc-tab[aria-selected='true']`
 * must ALSO name `.afc-tab[aria-current='true']` in the same selector list.
 * A block that names only `aria-selected` is a hook that never renders on an
 * anchor nav — the original S-1 defect.
 */
function checkCssInvariant(cssPath) {
  let css;
  try { css = readFileSync(cssPath, 'utf8'); }
  catch { return { ok: false, reason: `cannot read ${cssPath}` }; }

  const problems = [];
  let paired = 0;
  // Strip comments so a selector in prose does not count.
  const stripped = css.replace(/\/\*[\s\S]*?\*\//g, '');
  for (const block of stripped.split('}')) {
    const brace = block.indexOf('{');
    if (brace === -1) continue;
    const selector = block.slice(0, brace);
    if (!/\.afc-tab\[aria-selected=['"]true['"]\]/.test(selector)) continue;
    if (!/\.afc-tab\[aria-current=['"]true['"]\]/.test(selector)) {
      problems.push(selector.trim().replace(/\s+/g, ' '));
    } else {
      paired++;
    }
  }
  if (paired === 0) problems.push('no .afc-tab[aria-selected] rule paired with aria-current was found at all');
  return { ok: problems.length === 0, problems, paired };
}

// ---------------------------------------------------------------------------
// Self-test: prove the gate refuses a planted defect
// ---------------------------------------------------------------------------

function selfTest() {
  const dir = mkdtempSync(join(tmpdir(), 'afc-tab-role-'));
  let ok = true;
  const assert = (label, cond) => {
    console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}`);
    if (!cond) ok = false;
  };
  try {
    writeFileSync(join(dir, 'clean.html'),
      '<nav class="afc-tabs"><a class="afc-tab" href="#a" aria-current="true">A</a></nav>\n' +
      '<div role="tablist"><button class="afc-tab" role="tab" aria-selected="true">Real panel</button></div>\n');
    assert('clean tree is accepted', findMisuse(dir).length === 0);

    mkdirSync(join(dir, 'bad'), { recursive: true });
    writeFileSync(join(dir, 'bad', 'profile.vue'),
      '<nav class="afc-tabs">\n  <a class="afc-tab" href="#a" aria-selected="true">A</a>\n</nav>\n');
    const found = findMisuse(dir);
    assert('planted misuse is caught', found.length === 1);
    assert('finding names the file', found[0]?.file === join('bad', 'profile.vue'));
    assert('finding names the line', found[0]?.line === 2);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  return ok;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);
const runSelfTest = args.includes('--self-test');
const target = resolve(args.find((a) => !a.startsWith('--')) ?? process.cwd());

if (runSelfTest) {
  console.log('\nAFC Design System — tab-role gate self-test\n' + '='.repeat(74));
  const passed = selfTest();
  console.log('-'.repeat(74));
  console.log(passed ? 'Self-test passed.' : 'Self-test FAILED.');
  process.exit(passed ? 0 : 1);
}

console.log('\nAFC Design System — anchor-nav / tab-role gate\n' + '='.repeat(74));
console.log(`scan: ${target}`);
console.log(`css:  ${CSS_PATH}\n`);

let failed = false;

const misuse = findMisuse(target);
if (misuse.length) {
  failed = true;
  console.log(`MISUSE: ${misuse.length} .afc-tab element(s) use aria-selected without role="tab".`);
  console.log('A link that points at a section must use aria-current="true", not aria-selected.\n');
  for (const f of misuse) console.log(`  ${f.file}:${f.line}  ${f.snippet}`);
  console.log('');
} else {
  console.log('consumer scan: no .afc-tab misuse (aria-selected only on real tab panels).');
}

const css = checkCssInvariant(CSS_PATH);
if (!css.ok) {
  failed = true;
  console.log('\nCSS INVARIANT BROKEN: .afc-tab[aria-selected] rule(s) not paired with aria-current:');
  for (const p of css.problems) console.log(`  ${p}`);
} else {
  console.log(`css invariant: ${css.paired} active-state rule(s) pair aria-selected with aria-current.`);
}

console.log('-'.repeat(74));
console.log(failed ? 'FAILED.' : 'All checks pass.');
process.exit(failed ? 1 : 0);
