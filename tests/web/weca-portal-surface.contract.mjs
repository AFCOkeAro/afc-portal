/**
 * AFC-475 contract tests — WECA portal surface over the ADR-0008 model.
 *
 * Pure node:test, no dependencies. Asserts the structural contract the
 * finance routes and pages are built on:
 *   1. Configuration vs code (ADR-0008 A3): no hard-coded rates or
 *      thresholds anywhere in the finance surface. The grep gate in the
 *      issue names 25000/75000/0.10/0.20 outside tests/fixtures; this test
 *      is that gate for the files this slice owns.
 *   2. Read-only formula surface: versions list from weca_return_formulas
 *      rows; no write route exists for the collection.
 *   3. Pending honesty: formula_pending renders as "pending board formula"
 *      with nulls, never fabricated figures; the summary counts pending
 *      lines instead of zero-filling them.
 *   4. Permissions (§10/§11.1): every finance route checks a grant and
 *      stays in scope; amounts leave through visibleFields/stripHidden only;
 *      the exports respect the same grants.
 *   5. Lifecycle + audit: draft→submitted→confirmed with actor stamps on
 *      records; calculated→submitted→confirmed with timestamp stamps on
 *      returns; computed lines are never hand-edited.
 *
 * Run: node --test tests/web/weca-portal-surface.contract.mjs
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const read = (rel) => readFileSync(path.join(root, rel), 'utf8')
const codeOf = (rel) =>
  read(rel)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*/g, '')

const FINANCE_API = 'apps/web/server/api/finance'
const FINANCE_PAGES = 'apps/web/pages/finance'
const COLLECTOR = 'apps/web/server/utils/weca-summary.ts'
const MIDDLEWARE = 'apps/web/middleware/finance.ts'

function walk(dir, out = []) {
  for (const entry of readdirSync(path.join(root, dir), { withFileTypes: true })) {
    const rel = path.posix.join(dir, entry.name)
    if (entry.isDirectory()) walk(rel, out)
    else out.push(rel)
  }
  return out
}

const apiFiles = walk(FINANCE_API)
const pageFiles = walk(FINANCE_PAGES)
const surfaceFiles = [...apiFiles, ...pageFiles, COLLECTOR, MIDDLEWARE]

describe('weca surface — file inventory', () => {
  it('the slice owns the routes, pages, collector and guard it claims', () => {
    for (const rel of [
      `${FINANCE_API}/records/index.get.ts`,
      `${FINANCE_API}/records/index.post.ts`,
      `${FINANCE_API}/records/[id].get.ts`,
      `${FINANCE_API}/records/[id].patch.ts`,
      `${FINANCE_API}/records/export.csv.get.ts`,
      `${FINANCE_API}/returns/index.get.ts`,
      `${FINANCE_API}/returns/index.post.ts`,
      `${FINANCE_API}/returns/[id].get.ts`,
      `${FINANCE_API}/returns/[id].patch.ts`,
      `${FINANCE_API}/returns/export.csv.get.ts`,
      `${FINANCE_API}/formulas/index.get.ts`,
      `${FINANCE_API}/summary.get.ts`,
      `${FINANCE_PAGES}/records/index.vue`,
      `${FINANCE_PAGES}/records/new.vue`,
      `${FINANCE_PAGES}/records/[id].vue`,
      `${FINANCE_PAGES}/returns/index.vue`,
      `${FINANCE_PAGES}/returns/[id].vue`,
      `${FINANCE_PAGES}/summary.vue`,
      `${FINANCE_PAGES}/formulas.vue`,
      COLLECTOR,
      MIDDLEWARE,
    ]) {
      assert.ok(existsSync(path.join(root, rel)), `${rel} exists`)
    }
  })

  it('no migration ships with this slice', () => {
    const migrations = readdirSync(
      path.join(root, 'services/directus/schema/migrations'),
    )
    assert.ok(
      !migrations.some((name) => /weca.*surface|475/.test(name)),
      'display-only indexes were not needed, so no migration was added',
    )
  })
})

describe('weca surface — no hard-coded rates or thresholds (A3)', () => {
  it('no threshold literals in the finance surface', () => {
    for (const rel of surfaceFiles) {
      const src = codeOf(rel)
      assert.doesNotMatch(src, /\b25000\b/, `${rel} must not name the low-band threshold`)
      assert.doesNotMatch(src, /\b75000\b/, `${rel} must not name the high-band threshold`)
      assert.doesNotMatch(
        src,
        /74,?999/,
        `${rel} must not name the sheet ceiling either`,
      )
    }
  })

  it('no rate literals in the finance surface', () => {
    for (const rel of surfaceFiles) {
      const src = codeOf(rel)
      assert.doesNotMatch(src, /\b0\.10\b/, `${rel} must not hard-code the 10% rate`)
      assert.doesNotMatch(src, /\b0\.20\b/, `${rel} must not hard-code the 20% rate`)
      assert.doesNotMatch(src, /\b0\.05\b/, `${rel} must not hard-code the 5% rate`)
    }
  })

  it('no arithmetic on money with a literal factor', () => {
    for (const rel of surfaceFiles) {
      const src = codeOf(rel)
      assert.doesNotMatch(
        src,
        /income\s*\*\s*0\./,
        `${rel} must never compute from income with a literal factor`,
      )
    }
  })

  it('the only percent math is unit conversion of a row value at render time', () => {
    const src = codeOf(`${FINANCE_PAGES}/formulas.vue`)
    assert.match(src, /rate\s*\*\s*100/, 'percent labels derive from the row value')
  })
})

describe('weca surface — read-only formula schedule', () => {
  it('the formulas directory holds no write route', () => {
    const files = walk(`${FINANCE_API}/formulas`)
    assert.deepEqual(
      files.map((file) => path.basename(file)),
      ['index.get.ts'],
      'versions are listed, never written from the portal',
    )
  })

  it('no route writes a formula version or a computed line', () => {
    for (const rel of apiFiles) {
      const src = codeOf(rel)
      assert.doesNotMatch(
        src,
        /\bformula_version['"]?\s*:/,
        `${rel} must never set formula_version (the computation owns it)`,
      )
    }
    // A bare mention is the refusal denylist (the [id].patch guard names
    // the fields it rejects); a write is a key with a value. Only the
    // latter is forbidden here.
    for (const rel of apiFiles.filter((file) => /patch|post/.test(file))) {
      const src = codeOf(rel)
      assert.doesNotMatch(src, /computed_mf['"]?\s*:/, `${rel} must never write a computed line`)
      assert.doesNotMatch(src, /computed_area['"]?\s*:/, `${rel} must never write a computed line`)
      assert.doesNotMatch(src, /computed_savings['"]?\s*:/, `${rel} must never write a computed line`)
      assert.doesNotMatch(src, /total_due['"]?\s*:/, `${rel} must never write the total`)
    }
  })

  it('the create-return route refuses a period that is not the record month', () => {
    const src = codeOf(`${FINANCE_API}/returns/index.post.ts`)
    assert.match(src, /period_mismatch/, 'period must match the source record month')
  })
})

describe('weca surface — pending honesty', () => {
  it('returns pages name the pending state instead of fabricating figures', () => {
    for (const rel of [
      `${FINANCE_PAGES}/returns/index.vue`,
      `${FINANCE_PAGES}/returns/[id].vue`,
      `${FINANCE_PAGES}/summary.vue`,
    ]) {
      const src = codeOf(rel)
      assert.match(src, /formula_pending/, `${rel} branches on the pending state`)
      assert.match(
        src,
        /[Pp]ending board formula/,
        `${rel} tells the reader nothing is computed yet`,
      )
    }
  })

  it('the summary counts pending lines instead of zero-filling them', () => {
    const src = codeOf(COLLECTOR)
    assert.match(src, /formula_pending/, 'pending lines are detected')
    assert.match(src, /pending \+= 1/, 'pending lines are counted')
    assert.match(src, /amounts_visible/, 'totals depend on the computed-field grant')
  })

  it('the returns CSV marks unseen cells truthfully', () => {
    const src = codeOf(`${FINANCE_API}/returns/export.csv.get.ts`)
    assert.match(src, /'pending'/, 'formula-pending cells read pending')
    assert.match(src, /'restricted'/, 'grant-hidden cells read restricted, never zero')
  })
})

describe('weca surface — permissions (§10, §11.1)', () => {
  it('every finance route checks a grant before reading', () => {
    for (const rel of apiFiles.filter((file) => /\.get\.ts$/.test(file))) {
      const src = codeOf(rel)
      assert.match(src, /requireCan\(scope,/, `${rel} must check a grant`)
    }
  })

  it('every finance write route checks an update or create grant', () => {
    for (const rel of apiFiles.filter((file) => /\.(post|patch)\.ts$/.test(file))) {
      const src = codeOf(rel)
      assert.match(src, /requireCan\(scope,/, `${rel} must check a grant`)
    }
  })

  it('list and detail routes stay inside the caller scope', () => {
    // The formulas schedule is exempt: versions are area-wide board config
    // with no branch column (the service_type_definitions precedent), so
    // there is no scope predicate to apply -- the grant check above is the
    // control.
    const scoped = apiFiles.filter(
      (file) =>
        (/index\.get|\[id\]\.get/.test(file) && !/formulas/.test(file)) ||
        /summary\.get/.test(file),
    )
    for (const rel of scoped) {
      const src = codeOf(rel)
      assert.ok(
        // The summary route delegates to the shared collector, which applies
        // the scope predicate itself (same structural guarantee, one place).
        /scopeFilter\(scope\)/.test(src) ||
          /findScopedItem/.test(src) ||
          /collectFinanceSummary\(event, scope/.test(src),
        `${rel} must scope by branch, resolve through a scoped lookup, or delegate to the scoped collector`,
      )
    }
  })

  it('computed and capture amounts leave through the field restriction only', () => {
    for (const rel of [
      `${FINANCE_API}/records/index.get.ts`,
      `${FINANCE_API}/records/[id].get.ts`,
      `${FINANCE_API}/returns/index.get.ts`,
      `${FINANCE_API}/returns/[id].get.ts`,
    ]) {
      const src = codeOf(rel)
      assert.match(src, /visibleFields\(scope,/, `${rel} must project visible fields`)
      assert.match(src, /stripHidden/, `${rel} must strip hidden amounts`)
    }
  })

  it('the exports respect the same grants as the pages', () => {
    const records = codeOf(`${FINANCE_API}/records/export.csv.get.ts`)
    assert.match(records, /visibleFields\(scope,/, 'records CSV projects visible fields')
    const summary = codeOf(COLLECTOR)
    assert.match(summary, /visibleFields\(scope, 'weca_returns'/, 'returns CSV inherits the computed grant')
  })

  it('the guard reads capabilities, not a role name', () => {
    const src = codeOf(MIDDLEWARE)
    assert.match(src, /permissions\.can\(/, 'guard reads capabilities')
    assert.doesNotMatch(src, /branch_admin|area_admin/, 'guard names no role')
  })
})

describe('weca surface — lifecycle and audit', () => {
  it('records move draft to submitted to confirmed with actor stamps', () => {
    const src = codeOf(`${FINANCE_API}/records/[id].patch.ts`)
    assert.match(src, /draft/, 'draft is the start of the lifecycle')
    assert.match(src, /submitted_by/, 'submission stamps the actor')
    assert.match(src, /confirmed_by/, 'confirmation stamps the actor')
    assert.match(src, /record_locked/, 'audited records cannot be edited in place')
  })

  it('records are created draft, never pre-submitted', () => {
    const src = codeOf(`${FINANCE_API}/records/index.post.ts`)
    assert.match(src, /status: 'draft'/, 'creation forces the draft state')
  })

  it('returns submit only when computed, and stamp the transition', () => {
    const src = codeOf(`${FINANCE_API}/returns/[id].patch.ts`)
    assert.match(src, /pending_formula/, 'formula_pending returns cannot submit')
    assert.match(src, /computed_readonly/, 'computed lines are refused, not ignored')
    assert.match(src, /submitted_at/, 'submission stamps the transition')
    assert.match(src, /confirmed_at/, 'confirmation stamps the transition')
  })

  it('returns record who opened them', () => {
    const src = codeOf(`${FINANCE_API}/returns/index.post.ts`)
    assert.match(src, /generated_by/, 'the opener is recorded')
  })
})
