/**
 * AFC-472 contract tests — welfare hardening: confidentiality, case notes,
 * reporting/export.
 *
 * Pure node:test, no dependencies. Asserts the structural contract the
 * welfare routes are built on:
 *   1. Confidentiality: the list/detail queries select the column and the
 *      list route honours a confidentiality filter.
 *   2. Notes: a dedicated notes route appends event_type `note` with
 *      detail/body and an auto-set audit actor; the detail page lists notes
 *      separately from the trail and posts to the route.
 *   3. Audit: every create/status-change/assign/note/contribution writes a
 *      welfare_case_events row with the session user as actor.
 *   4. Reports: the JSON report and the CSV export read the same shared
 *      collector over the same scoped query; neither selects restricted
 *      fields (description/outcome_notes never in payload).
 *   5. Scoping (assigned vs unassigned reader): every case-facing route
 *      resolves the case through findScopedItem, which 404s out-of-scope
 *      rows instead of returning them.
 *
 * Run: node --test tests/web/welfare-hardening.contract.mjs
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

const ROUTES = {
  list: 'apps/web/server/api/welfare/index.get.ts',
  detail: 'apps/web/server/api/welfare/[id].get.ts',
  create: 'apps/web/server/api/welfare/index.post.ts',
  patch: 'apps/web/server/api/welfare/[id].patch.ts',
  notes: 'apps/web/server/api/welfare/[id]/notes.post.ts',
  contributionPost: 'apps/web/server/api/welfare/[id]/contributions.post.ts',
  contributionPatch: 'apps/web/server/api/welfare/contributions/[id].patch.ts',
  reports: 'apps/web/server/api/welfare/reports.get.ts',
  reportsCsv: 'apps/web/server/api/welfare/reports.csv.get.ts',
  collector: 'apps/web/server/utils/welfare-report.ts',
}

describe('welfare hardening — confidentiality', () => {
  it('the list and detail queries select confidentiality', () => {
    for (const rel of [ROUTES.list, ROUTES.detail]) {
      const src = codeOf(rel)
      assert.match(src, /confidentiality/, `${rel} must select confidentiality`)
    }
  })

  it('the list route honours a confidentiality filter inside the caller scope', () => {
    const src = codeOf(ROUTES.list)
    assert.match(src, /confidentiality.*_eq/, 'a confidentiality filter must exist')
    assert.match(src, /scopeFilter\(scope\)/, 'the filter must stay inside the scope predicate')
  })

  it('the create and update routes persist confidentiality', () => {
    for (const rel of [ROUTES.create, ROUTES.patch]) {
      assert.match(codeOf(rel), /confidentiality/, `${rel} must persist confidentiality`)
    }
  })
})

describe('welfare hardening — case notes', () => {
  it('the notes route writes event_type note with detail/body and an auto-set actor', () => {
    const src = codeOf(ROUTES.notes)
    assert.match(src, /event_type.*note/, 'notes must land as event_type note')
    assert.match(src, /\bbody\b/, 'notes must carry the freeform body')
    assert.match(src, /actor_user: scope\.session\.user\.id/, 'the audit actor is the session user')
    assert.match(src, /findScopedItem/, 'notes resolve the case inside the caller scope')
  })

  it('the notes route requires welfare_cases read, not a new privilege', () => {
    const src = codeOf(ROUTES.notes)
    assert.match(src, /requireCan\(scope, 'welfare_cases', 'read'\)/, 'notes gate on case read')
  })

  it('the detail page separates notes from the trail and posts to the route', () => {
    const src = codeOf('apps/web/pages/welfare/[id].vue')
    assert.match(src, /\/api\/welfare\/.*\/notes/, 'the page must post to the notes route')
    assert.match(src, /event_type === 'note'/, 'notes must render apart from the trail')
  })
})

describe('welfare hardening — audit trail', () => {
  it('every mutation writes a case event with the session user as actor', () => {
    for (const rel of [
      ROUTES.create,
      ROUTES.patch,
      ROUTES.notes,
      ROUTES.contributionPost,
      ROUTES.contributionPatch,
    ]) {
      const src = codeOf(rel)
      assert.match(
        src,
        /welfare_case_events/,
        `${rel} must write a welfare_case_events row`,
      )
      assert.match(
        src,
        /actor_user: scope\.session\.user\.id/,
        `${rel} must auto-set the audit actor to the session user`,
      )
    }
  })

  it('status changes and assignments get their own event types', () => {
    const src = codeOf(ROUTES.patch)
    assert.match(src, /status_changed/, 'status changes must be typed status_changed')
    assert.match(src, /assigned/, 'assignments must be typed assigned')
  })
})

describe('welfare hardening — reports and CSV', () => {
  it('the JSON report and the CSV read the same shared collector', () => {
    assert.match(
      codeOf(ROUTES.reports),
      /buildWelfareReport/,
      'the JSON report must read the shared collector',
    )
    const csv = codeOf(ROUTES.reportsCsv)
    assert.match(csv, /collectWelfareAggregate/, 'the CSV must read the shared aggregate')
    assert.match(csv, /buildWelfareReport\(event, scope\)/, 'the CSV must reuse the same scoped report')
  })

  it('restricted fields never enter the report payload or its export', () => {
    for (const rel of [ROUTES.collector, ROUTES.reportsCsv]) {
      const src = codeOf(rel)
      assert.doesNotMatch(src, /description/, `${rel} must never select description`)
      assert.doesNotMatch(src, /outcome_notes/, `${rel} must never select outcome_notes`)
    }
  })
})

describe('welfare hardening — scoping (assigned vs unassigned reader)', () => {
  it('every case-facing route resolves through findScopedItem', () => {
    for (const rel of [
      ROUTES.detail,
      ROUTES.patch,
      ROUTES.notes,
      ROUTES.contributionPost,
    ]) {
      assert.match(
        codeOf(rel),
        /findScopedItem[\s\S]*?\(\s*event,\s*scope,\s*'welfare_cases'/,
        `${rel} must resolve the case inside the caller scope (unassigned readers 404)`,
      )
    }
  })

  it('the contribution status route checks the parent case scope', () => {
    assert.match(
      codeOf(ROUTES.contributionPatch),
      /findScopedItem[\s\S]*?\(\s*event,\s*scope,\s*'welfare_cases'/,
      'a contribution cannot be reached through a case outside the caller scope',
    )
  })
})
