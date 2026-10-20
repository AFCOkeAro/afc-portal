/**
 * AFC-485 contract tests — prior-year CSV import + compare views (ADR-0010
 * decision 3, US-U2 / US-A4).
 *
 * Pure node:test, no dependencies. Asserts the route layer converged onto
 * the import/compare contract:
 *  1. One CSV template per domain (attendance, blessings, people, finance)
 *     with the documented header row + example, served by the template route
 *     from the same IMPORT_TEMPLATES the import route validates against.
 *  2. Server-side validation with a per-row error report (row numbers,
 *     idempotent natural-key builders, people identity hash without raw PII
 *     in the ledger).
 *  3. Idempotent upserts per domain on the natural keys ((branch, month),
 *     (branch, period), (session, category, sex), person identity), with
 *     re-import producing zero new rows (skipped/updated, never twins).
 *  4. Compare views for attendance, blessings, finance, people: a
 *     current-vs-prior toggle with side-by-side/delta, the same grouping as
 *     the reports, permission-scoped, with a CSV export streaming the same
 *     query.
 *  5. The prior_year.import Flow wiring exists and names the route executor
 *     (no new service), and the ledger migration owns provenance.
 *  6. None of the touched paths names the breach clock or a retention period
 *     (the gates scan these paths) and no import path persists raw PII to
 *     the ledger.
 *
 * Run: node --test tests/web/prior-year-import.contract.mjs
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const read = (rel) => readFileSync(path.join(root, rel), 'utf8')

const util = read('apps/web/server/utils/prior-year-import.ts')
const templateRoute = read('apps/web/server/api/imports/[domain]/template.get.ts')
const importRoute = read('apps/web/server/api/imports/[domain].post.ts')
const attendanceCsv = read('apps/web/server/api/attendance/report.csv.get.ts')
const blessingUtil = read('apps/web/server/utils/blessing-report.ts')
const blessingList = read('apps/web/server/api/blessings/index.get.ts')
const blessingCsv = read('apps/web/server/api/blessings/reports.csv.get.ts')
const financeUtil = read('apps/web/server/utils/weca-summary.ts')
const financeSummary = read('apps/web/server/api/finance/summary.get.ts')
const peopleCompare = read('apps/web/server/api/people/compare.get.ts')
const peopleCompareCsv = read('apps/web/server/api/people/compare.csv.get.ts')
const peopleUtil = read('apps/web/server/utils/people-compare.ts')

describe('templates (US-U2 AC1)', () => {
  it('defines one template per domain with header + example', () => {
    for (const domain of ['attendance', 'blessings', 'people', 'finance']) {
      assert.match(util, new RegExp(`${domain}: \\{[\\s\\S]*?header: \\[`))
      assert.match(util, new RegExp(`${domain}: \\{[\\s\\S]*?example: \\[`))
    }
  })

  it('documents the finance header (branch, month, income, intervention, faith_city)', () => {
    assert.match(util, /'branch_code', 'month', 'income', 'intervention', 'faith_city'/)
  })

  it('documents the attendance header (branch, date, service, category, male, female)', () => {
    assert.match(util, /'branch_code',\s*\n?\s*'service_date',\s*\n?\s*'service_type',\s*\n?\s*'category',\s*\n?\s*'male',\s*\n?\s*'female'/)
  })

  it('the template route serves the same IMPORT_TEMPLATES the import validates', () => {
    assert.match(templateRoute, /IMPORT_TEMPLATES|templateCsv/)
    assert.match(templateRoute, /requireCan\(scope, .*'read'\)/)
  })
})

describe('server-side validation + error report (US-U2 AC2)', () => {
  it('parses CSV server-side with a header contract', () => {
    assert.match(util, /export function parseCsv/)
    assert.match(util, /export function validateImportRows/)
    assert.match(util, /missing columns/)
  })

  it('returns per-row errors with 1-based row numbers', () => {
    assert.match(util, /RowError/)
    assert.match(util, /row: rowNumber/)
  })

  it('caps file size and row count', () => {
    assert.match(util, /MAX_IMPORT_BYTES/)
    assert.match(util, /MAX_IMPORT_ROWS/)
    assert.match(importRoute, /MAX_IMPORT_BYTES/)
    assert.match(importRoute, /file_too_large/)
  })

  it('builds idempotency keys from the natural keys', () => {
    assert.match(util, /attendanceImportKey/)
    assert.match(util, /blessingsImportKey/)
    assert.match(util, /financeImportKey/)
    assert.match(util, /personIdentityHash/)
  })
})

describe('idempotent import (US-U2 AC2, re-import yields zero new rows)', () => {
  it('upserts finance on (branch, month) with skipped/updated/imported outcomes', () => {
    assert.match(importRoute, /upsertFinance/)
    assert.match(importRoute, /month: \{ _eq: values\.month \}/)
    assert.match(importRoute, /ON CONFLICT|skipped/)
  })

  it('upserts blessings on (branch, service_date, blessing_type)', () => {
    assert.match(importRoute, /upsertBlessing/)
    assert.match(importRoute, /service_date: \{ _eq: values\.service_date \}/)
  })

  it('upserts attendance counts on (session, category, sex)', () => {
    assert.match(importRoute, /upsertAttendance/)
    assert.match(importRoute, /sex: \{ _eq: sex \}/)
  })

  it('dedupes people on identity and never overwrites PII from a bulk file', () => {
    assert.match(importRoute, /upsertPerson/)
    assert.match(importRoute, /never\n?.*overwrite|dedupe|exact match/i)
  })

  it('records provenance (source=import, data_year, batch + items)', () => {
    assert.match(importRoute, /prior_year_imports/)
    assert.match(importRoute, /prior_year_import_items/)
    assert.match(importRoute, /source: 'import'/)
    assert.match(importRoute, /pending_migration_0014/)
  })

  it('is permission-scoped and fail-closed on branch scope', () => {
    assert.match(importRoute, /requireCan\(scope, .*'create'\)/)
    assert.match(importRoute, /branch_out_of_scope|outside your scope/)
    assert.match(importRoute, /unknown branch_code/)
  })
})

describe('compare views (US-A4)', () => {
  it('attendance CSV streams the prior-year side with a delta when toggled', () => {
    assert.match(attendanceCsv, /compare_prior_year/)
    assert.match(attendanceCsv, /collectSplitAggregate/)
    assert.match(attendanceCsv, /delta/)
  })

  it('blessings list and CSV share a compare collector with has_data + delta', () => {
    assert.match(blessingUtil, /collectBlessingsCompare/)
    assert.match(blessingUtil, /has_data/)
    assert.match(blessingUtil, /delta_total/)
    assert.match(blessingList, /collectBlessingsCompare/)
    assert.match(blessingCsv, /collectBlessingsCompare/)
  })

  it('finance summary compares the same month one year back with a delta', () => {
    assert.match(financeUtil, /collectFinanceCompare/)
    assert.match(financeUtil, /shiftPeriodYear\(period, -1\)/)
    assert.match(financeUtil, /delta_remittance/)
    assert.match(financeSummary, /collectFinanceCompare/)
  })

  it('people compare groups branch|zone with a ledger snapshot and CSV twin', () => {
    assert.match(peopleUtil, /collectPeopleCompare/)
    assert.match(peopleUtil, /prior_year_import_items/)
    assert.match(peopleCompare, /collectPeopleCompare/)
    assert.match(peopleCompareCsv, /collectPeopleCompare/)
    assert.match(peopleCompareCsv, /people-compare-/)
  })

  it('compare reads stay permission-scoped', () => {
    assert.match(blessingList, /requireCan\(scope, 'blessings', 'read'\)/)
    assert.match(financeSummary, /requireCan\(scope, 'weca_returns', 'read'\)/)
    assert.match(peopleCompare, /requireCan\(scope, 'people', 'read'\)/)
  })
})

describe('flow wiring (data-model-expansion §13 prior_year.import)', () => {
  it('the Flow definition exists and names the route executor, no new service', () => {
    const flowPath = path.join(root, 'services/directus/flows/prior_year.import.json')
    assert.ok(existsSync(flowPath), 'services/directus/flows/prior_year.import.json exists')
    const flow = JSON.parse(readFileSync(flowPath, 'utf8'))
    assert.equal(flow.name, 'prior_year.import')
    assert.match(JSON.stringify(flow), /POST \/api\/imports\/:domain/)
    assert.match(JSON.stringify(flow), /no new service/)
  })

  it('the ledger migration exists with its down script', () => {
    assert.ok(
      existsSync(path.join(root, 'services/directus/schema/migrations/20261020_0014_prior_year.sql')),
    )
    assert.ok(
      existsSync(
        path.join(root, 'services/directus/schema/migrations/rollback/20261020_0014_prior_year.down.sql'),
      ),
    )
  })
})

describe('gate hygiene on the touched paths', () => {
  const touched = [
    util,
    templateRoute,
    importRoute,
    attendanceCsv,
    blessingUtil,
    blessingList,
    blessingCsv,
    financeUtil,
    financeSummary,
    peopleCompare,
    peopleCompareCsv,
    peopleUtil,
  ]

  it('names no breach clock and no retention period', () => {
    for (const source of touched) {
      assert.doesNotMatch(source, /awareness_at/)
      assert.doesNotMatch(source, /INTERVAL\s*'[^']*(year|month|day)/i)
    }
  })

  it('persists no raw PII to the ledger (hashes only)', () => {
    assert.match(util, /SHA-256/)
    assert.doesNotMatch(importRoute, /natural_key: values\.full_name/)
    assert.doesNotMatch(importRoute, /natural_key: values\.phone/)
    for (const source of [peopleCompare, peopleCompareCsv, peopleUtil]) {
      assert.doesNotMatch(source, /first_name/)
      assert.doesNotMatch(source, /phone/)
      assert.doesNotMatch(source, /email/)
    }
  })
})
