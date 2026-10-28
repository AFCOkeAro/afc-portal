/**
 * AFC-825 contract tests — event budgets with budget-vs-actual.
 *
 * Per-category planned lines (append-only; latest row per category wins)
 * calculated against summed event_expenses, with admin-managed spend
 * categories (expense_categories register, seeded with the 0044 eight).
 *
 * Run: node --test tests/web/event-budgets.contract.mjs
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const read = (rel) => readFileSync(path.join(root, rel), 'utf8')
const codeOf = (rel) =>
  read(rel)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*/g, '')

const MIGRATION = 'services/directus/schema/migrations/20261028_0045_event_budgets.sql'
const DOWN =
  'services/directus/schema/migrations/rollback/20261028_0045_event_budgets.down.sql'
const SUITE = 'tests/db/45_event_budgets.sql'
const GET = 'apps/web/server/api/events/[id]/budgets/index.get.ts'
const POST = 'apps/web/server/api/events/[id]/budgets/index.post.ts'
const CATS_GET = 'apps/web/server/api/expense-categories/index.get.ts'
const CATS_POST = 'apps/web/server/api/expense-categories/index.post.ts'
const PAGE = 'apps/web/pages/events/[id].vue'

describe('migration 0045: budgets + categories register', () => {
  it('creates both registers with the seeded taxonomy', () => {
    const src = codeOf(MIGRATION)
    assert.match(src, /CREATE TABLE IF NOT EXISTS expense_categories/)
    assert.match(src, /CREATE TABLE IF NOT EXISTS event_budgets/)
    assert.match(src, /'venue',\s*'Venue'/)
    assert.match(src, /ON CONFLICT \(key\) DO NOTHING/)
  })

  it('points expenses at the register and keeps the other-label pairing', () => {
    const src = codeOf(MIGRATION)
    assert.match(src, /DROP CONSTRAINT event_expenses_category_check/)
    assert.match(src, /event_expenses_category_fkey/)
    assert.match(src, /REFERENCES expense_categories\(key\)/)
    assert.doesNotMatch(
      src,
      /other_label/,
      'the other-label pairing CHECK is untouched (comments stripped, so any hit is code)',
    )
  })

  it('grants the scoped ceiling: budgets append-only, categories no DELETE', () => {
    const src = codeOf(MIGRATION)
    assert.match(src, /GRANT SELECT ON expense_categories TO directus_app/)
    assert.match(src, /GRANT SELECT ON event_budgets TO directus_app/)
    assert.match(src, /INSERT \(event, category_key, amount, notes, recorded_by\)/)
    assert.doesNotMatch(src, /UPDATE event_budgets|UPDATE ON event_budgets/)
    assert.match(src, /REVOKE ALL ON expense_categories FROM PUBLIC/)
    assert.match(src, /REVOKE ALL ON event_budgets FROM PUBLIC/)
  })

  it('the rollback refuses with rows, custom keys or stray spend, then restores', () => {
    const src = codeOf(DOWN)
    assert.match(src, /event_budgets: the table holds/)
    assert.match(src, /non-seed categor/)
    assert.match(src, /stray expenses/)
    assert.match(src, /ADD CONSTRAINT event_expenses_category_check/)
    assert.match(src, /DROP TABLE IF EXISTS event_budgets/)
    assert.match(src, /DROP TABLE IF EXISTS expense_categories/)
  })
})

describe('budgets API: latest-wins read, gated write', () => {
  it('GET resolves the latest row per category behind the read grant', () => {
    const src = codeOf(GET)
    assert.match(src, /event_budgets.*read/)
    assert.match(src, /seen\.has\(key\)/, 'dedupes to the latest per category')
    assert.match(src, /eventScopeFilter/, 'event must be in scope')
  })

  it('POST opens on events update OR budgets create, with a live category', () => {
    const src = codeOf(POST)
    assert.match(src, /events.*update/)
    assert.match(src, /event_budgets.*create/)
    assert.match(src, /unknown_category/)
    assert.match(src, /category_inactive/)
  })

  it('categories are staff-listed and area-written, with named conflicts', () => {
    const get = codeOf(CATS_GET)
    assert.match(get, /event_expenses.*read/, 'forms list the taxonomy')
    const post = codeOf(CATS_POST)
    assert.match(post, /requireArea/, 'only area admins add keys')
    assert.match(post, /code: 'conflict'/)
  })
})

describe('expenses page: budget vs actual section', () => {
  it('renders per-category budget, actual, variance and spend bars', () => {
    const src = codeOf(PAGE)
    assert.match(src, /Budget vs actual/)
    assert.match(src, /budgetVariance/)
    assert.match(src, /Record a budget line/)
  })

  it('offers category creation to area admins only', () => {
    const src = codeOf(PAGE)
    assert.match(src, /canManageCategories/)
    assert.match(src, /area_admin/)
    assert.match(src, /super_admin/)
    assert.match(src, /Add a spend category/)
  })

  it('the expense category select is register-driven with a seed fallback', () => {
    const src = codeOf(PAGE)
    assert.match(src, /loadExpenseCategories/)
    assert.match(src, /\/api\/expense-categories/)
  })
})
