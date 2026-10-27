/**
 * AFC-801 contract tests — per-event expense records + Expenses tab.
 *
 * Pure node:test, no dependencies. Asserts the structural contract:
 *  1. The programme page carries an 8th Expenses tab (`?tab=expenses`,
 *     deep-linkable) that is hidden without the `event_expenses:read`
 *     grant, and the displayed total IS the sum of the listed rows
 *     (totals parity: no separate endpoint).
 *  2. GET scopes the event first (fail-closed 404 out of scope) and the
 *     rows second (event + branch/zone predicate); field hiding rides
 *     visibleFields/stripHiddenMany; store failures map to the named
 *     error, never a bare 500.
 *  3. POST opens on `events` update OR `event_expenses` create, validates
 *     category/amount/date at the route layer, stamps branch/zone from the
 *     parent event plus recorded_by from the session, and returns { data }.
 *  4. 400s carry { code, fields }; the migration and the routes ship no
 *     DELETE on the collection (append-only).
 *  5. The migration encodes the register: RESTRICT parent, strict
 *     other-label pairing, amount >= 0, write-once audit ground truth,
 *     rollback refuses while rows exist.
 *
 * Run: node --test tests/web/event-expenses.contract.mjs
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

/** Mirrors the page's expenseTotal: the displayed total is the row sum. */
function pageTotal(rows) {
  return rows.reduce((sum, row) => sum + Number(row.amount ?? 0), 0)
}

describe('expenses tab: 9th tab, deep-linkable, hidden without the grant', () => {
  const src = codeOf('apps/web/pages/events/[id].vue')

  it('adds Expenses as the 9th tab with a receipt icon', () => {
    assert.match(src, /id: 'expenses', label: 'Expenses', icon: 'i-lucide-receipt'/)
    const tabs = read('apps/web/pages/events/[id].vue').match(/\{ id: '(\w+)', label:/g)
    // AFC-806 added the Attendance tab after this pin; nine tabs now.
    assert.ok(tabs && tabs.length === 9, `nine tabs, found ${tabs ? tabs.length : 0}`)
    assert.ok(tabs[8].includes('expenses'), 'expenses is the 9th tab')
  })

  it('deep-links through ?tab=expenses and falls back to overview', () => {
    // Whitespace-tolerant: prettier reflows the long lines; the contract
    // pins the wired VALUES, not the line breaks (AFC-723 precedent).
    assert.match(src, /shownTabs\.value\.some\(/)
    assert.match(src, /entry\.id === value/)
    assert.match(src, /: 'overview'/)
  })

  it('hides the tab without the eventExpenses read grant', () => {
    assert.match(src, /entry\.id !== 'expenses' \|\| canExpenses\.value/)
    assert.match(src, /permissions\.can\(COLLECTIONS\.eventExpenses, 'read'\)/)
  })

  it('gates the New-expense button on create-or-events-update', () => {
    assert.match(src, /canRecordExpenses/)
    assert.match(src, /permissions\.can\(COLLECTIONS\.eventExpenses, 'create'\)/)
    assert.match(src, /permissions\.can\(COLLECTIONS\.events, 'update'\)/)
  })

  it('has no EntitySelect: category select + amount + date + notes/other-label only', () => {
    assert.doesNotMatch(src, /EntitySelect/)
    assert.match(src, /expenseCategoryOptions/)
    assert.match(src, /v-model="expenseForm\.amount"/)
    assert.match(src, /v-model="expenseForm\.spent_on"/)
    assert.match(src, /v-model="expenseForm\.notes"/)
    assert.match(src, /v-model="expenseForm\.category_other_label"/)
  })

  it('shows field errors next to inputs and a row-level alert', () => {
    assert.match(src, /expenseFieldErrors\.category/)
    assert.match(src, /expenseFieldErrors\.amount/)
    assert.match(src, /expenseFieldErrors\.spent_on/)
    assert.match(src, /expenseError/)
  })
})

describe('totals parity: the displayed total is the sum of the listed rows', () => {
  const src = codeOf('apps/web/pages/events/[id].vue')

  it('folds the total client-side from the scoped list', () => {
    assert.match(src, /expenses\.value\.reduce\(/)
    assert.match(src, /Number\(row\.amount \?\? 0\)/)
    assert.doesNotMatch(src, /\/api\/events\/\$\{id\}\/expenses\/total/)
    assert.doesNotMatch(src, /expenses-total/)
  })

  it('the mirror sum agrees on decimals, nulls and string amounts', () => {
    assert.equal(
      pageTotal([{ amount: '2500.50' }, { amount: '1500' }, { amount: null }, {}]),
      4000.5,
    )
    assert.equal(pageTotal([]), 0)
  })
})

describe('GET route: scoped event first, scoped rows second, named errors', () => {
  const src = codeOf('apps/web/server/api/events/[id]/expenses.get.ts')

  it('requires the eventExpenses read grant', () => {
    assert.match(src, /requireCan\(scope, 'event_expenses', 'read'\)/)
  })

  it('fails closed when the event is outside caller scope', () => {
    assert.match(src, /findScopedItem/)
    assert.match(src, /eventScopeFilter\(scope\)/)
  })

  it('bounds rows to the event AND the caller branch/zone predicate', () => {
    assert.match(src, /event: \{ _eq: id \}/)
    assert.match(src, /scopeFilter\(scope\)/)
    assert.match(src, /zoneScopeFilter\(scope\)/)
  })

  it('hides amount/notes from non-finance roles through the shared restriction', () => {
    assert.match(src, /visibleFields\(scope, 'event_expenses', EXPENSE_FIELDS\)/)
    assert.match(src, /stripHiddenMany\(/)
    assert.match(src, /'event_expenses'/)
  })

  it('maps store failures to the named error, never a bare 500', () => {
    assert.match(src, /throwStoreUnavailable\(error, 'expense_store', '0044'\)/)
    assert.match(
      src,
      /if \(\(error as \{ statusCode\?: number \}\)\?\.statusCode\) throw error/,
    )
  })

  it('returns the scoped list as { data } with no totals endpoint beside it', () => {
    assert.match(src, /return \{ data: rows \}/)
    assert.doesNotMatch(src, /total/)
  })
})

describe('POST route: either grant, validated, denormed, attributed', () => {
  const src = codeOf('apps/web/server/api/events/[id]/expenses.post.ts')

  it('opens on events update OR eventExpenses create, 403 otherwise', () => {
    assert.match(src, /can\(scope, 'events', 'update'\)/)
    assert.match(src, /can\(scope, 'event_expenses', 'create'\)/)
    assert.match(src, /statusCode: 403/)
  })

  it('validates category/amount/date at the route layer with field errors', () => {
    assert.match(src, /expenseFormSchema\.safeParse\(body\)/)
    assert.match(src, /throwValidation\(parsed\.error\)/)
  })

  it('denorms branch/zone from the parent event, never from the client', () => {
    assert.match(src, /fields: \['id', 'branch'\]/)
    assert.match(src, /listItems</)
    assert.match(src, /'branches'/)
    assert.doesNotMatch(src, /body\.branch/)
    assert.doesNotMatch(src, /body\.zone/)
  })

  it('stamps recorded_by from the server session', () => {
    assert.match(src, /recordedBy: scope\.session\.user\.id/)
  })

  it('returns the created row as { data } and maps store failures by name', () => {
    assert.match(src, /return \{ data: \{ \.\.\.created, id: String\(created\.id\) \} \}/)
    assert.match(src, /throwStoreUnavailable\(error, 'expense_store', '0044'\)/)
  })

  it('ships no PUT/PATCH/DELETE: append-only at the route layer', () => {
    assert.doesNotMatch(src, /updateItem/)
    assert.doesNotMatch(src, /deleteItem/)
    assert.doesNotMatch(src, /method: '(PUT|PATCH|DELETE)'/)
  })
})

describe('no-DELETE pin: migration + routes never delete expenses', () => {
  it('the migration grants no DELETE on the register', () => {
    const migration = read(
      'services/directus/schema/migrations/20261025_0044_event_expenses.sql',
    )
    assert.doesNotMatch(migration, /DELETE ON event_expenses TO directus_app/)
    assert.match(migration, /NO DELETE on the register/)
  })

  it('the rollback refuses while rows exist and drops with no CASCADE', () => {
    const down = read(
      'services/directus/schema/migrations/rollback/20261025_0044_event_expenses.down.sql',
    )
    assert.match(down, /refusing to roll back event_expenses/)
    assert.doesNotMatch(down, /CASCADE/)
  })

  it('no route file under events/[id] deletes from the collection', () => {
    for (const route of ['expenses.get.ts', 'expenses.post.ts']) {
      const src = codeOf(`apps/web/server/api/events/[id]/${route}`)
      assert.doesNotMatch(src, /DELETE/, `${route} ships no DELETE`)
    }
  })
})

describe('register shape: the migration encodes what the routes read', () => {
  const migration = read(
    'services/directus/schema/migrations/20261025_0044_event_expenses.sql',
  )

  it('carries the R1 self-claim and names the pending R2', () => {
    assert.match(migration, /R1 self-claim by Coder/)
    assert.match(migration, /R2.*CTO/)
  })

  it('constrains the parent with RESTRICT and the denorms with SET NULL', () => {
    assert.match(migration, /REFERENCES events\(id\) ON DELETE RESTRICT/)
    assert.match(migration, /REFERENCES branches\(id\) ON DELETE SET NULL/)
    assert.match(migration, /REFERENCES zones\(id\) ON DELETE SET NULL/)
  })

  it('pins the eight categories with strict other-label pairing', () => {
    assert.match(migration, /'venue', 'feeding', 'transport', 'publicity',/)
    assert.match(migration, /event_expenses_other_label/)
  })

  it('floors the amount at zero with an NGN default and a required date', () => {
    assert.match(migration, /amount.*CHECK \(amount >= 0\)/)
    assert.match(migration, /currency\s+text NOT NULL DEFAULT 'NGN'/)
    assert.match(migration, /spent_on\s+date NOT NULL/)
  })

  it('withholds UPDATE on the audit ground truth and carries no updated_at', () => {
    assert.match(
      migration,
      /GRANT UPDATE \(category, category_other_label, amount, currency, spent_on,/,
    )
    assert.doesNotMatch(migration, /updated_at/)
  })

  it('prechecks bootstrap roles and parent ownership per the 0042 pattern', () => {
    assert.match(migration, /directus_migrator.*directus_app/)
    assert.match(migration, /is not owned by /)
  })
})

describe('permissions: eventExpenses mirrors branch_financial_records', () => {
  const matrix = codeOf('packages/shared/src/role-matrix.ts')
  const collections = read('packages/shared/src/collections.ts')

  it('registers the collection name once', () => {
    assert.match(collections, /eventExpenses: 'event_expenses'/)
  })

  it('holds CRU own_branch for branch admins and R own_zone for zone admins', () => {
    assert.match(matrix, /\[COLLECTIONS\.eventExpenses\]/)
    const block = matrix.slice(matrix.indexOf('[COLLECTIONS.eventExpenses]'))
    const end = block.indexOf('[COLLECTIONS.', 1)
    const cell = end === -1 ? block : block.slice(0, end)
    assert.match(cell, /branch_admin: \[CRU, 'own_branch'/)
    assert.match(cell, /zone_admin: \[R, 'own_zone'\]/)
    assert.match(cell, /department_leader: \[NONE, 'none'\]/)
    assert.match(cell, /volunteer: \[NONE, 'none'\]/)
  })

  it('hides amount/notes from every role outside the finance set', () => {
    assert.match(
      matrix,
      /\[COLLECTIONS\.eventExpenses\]: \{\s*\n\s*fields: \['amount', 'notes'\]/,
    )
    assert.match(matrix, /roles: \['super_admin', 'area_admin', 'branch_admin'\]/)
  })
})

describe('AFC-824 receipt upload + linked download', () => {
  const UPLOAD = 'apps/web/server/api/events/[id]/expenses/upload.post.ts'
  const RECEIPT = 'apps/web/server/api/events/[id]/expenses/receipt.get.ts'
  const FORM = 'apps/web/pages/events/[id].vue'

  it('upload opens on the same gates as the expense create', () => {
    const src = codeOf(UPLOAD)
    assert.match(src, /events.*update/)
    assert.match(src, /event_expenses.*create/)
    assert.match(src, /Your role cannot record expenses on this event/)
  })

  it('upload caps size and type with named field errors', () => {
    const src = codeOf(UPLOAD)
    assert.match(src, /10 \* 1024 \* 1024/)
    assert.match(src, /application\/pdf/)
    assert.match(src, /image\/webp/)
    assert.match(src, /code: 'validation_error', fields: \{ file:/)
  })

  it('receipt download requires linkage to the exact event', () => {
    const src = codeOf(RECEIPT)
    assert.match(src, /event_expenses.*read/)
    assert.match(src, /receipt: \{ _eq: file \}/)
    assert.match(src, /That receipt is not on this event/)
  })

  it('the form uploads before create and links the returned id', () => {
    const src = codeOf(FORM)
    assert.match(src, /expenses\/upload/)
    assert.match(src, /receipt \? \{ receipt \} : \{\}/)
    assert.match(src, /Could not upload that receipt/)
  })

  it('rows link receipts through the scoped proxy', () => {
    const src = codeOf(FORM)
    assert.match(src, /expenses\/receipt\?file=/)
    assert.match(src, /target="_blank"/)
  })
})
