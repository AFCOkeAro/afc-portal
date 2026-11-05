/**
 * AFC-1058 contract tests — leave-register cutover (0067 over 0052, ADR-0012).
 *
 * Pure node:test, no dependencies. Pins the cutover diff:
 *   1. Migration 0067 converts the main-shape register (0052) to the
 *      ADR-0012 shape: requester_user NOT NULL backfilled from created_by
 *      (unmapped rows block apply and are named), requester_person
 *      backfilled nullable, days dropped (Mon–Fri compute), maternity→other
 *      + declined→rejected with audit notes, cancelled blocks apply,
 *      leave_request_events created + one `created` row per request,
 *      no DELETE grant, fail-closed preconditions, CTO header.
 *   2. Rollback refuses while either table holds rows; drops child first,
 *      restores the 0052 shape; no CASCADE.
 *   3. leave_balances is KEPT (owned by 0055, HR phase 1) — the migration
 *      never names it; Directus policy rows are never seeded here.
 *   4. Shared: collections entries (not navigable), matrix rows per
 *      ADR-0012 §Dec.4, reason field restriction per §Dec.3.
 *   5. Routes: no DELETE route on the audited register; index.post stamps
 *      requester_user server-side with no client days; mine filter and
 *      the pending/approved/rejected vocab ride the list route; both
 *      PATCH paths audit.
 *
 * Run: node --test tests/web/leave-register-cutover.contract.mjs
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
const sqlOf = (rel) =>
  codeOf(rel)
    .split('\n')
    .map((line) => line.replace(/--.*$/, ''))
    .join('\n')

const MIGRATION =
  'services/directus/schema/migrations/20261105_0067_leave_register_cutover.sql'
const DOWN =
  'services/directus/schema/migrations/rollback/20261105_0067_leave_register_cutover.down.sql'

describe('leave cutover — backfill and fail-closed gates (0067 §1–§2)', () => {
  const sql = sqlOf(MIGRATION)

  it('backfills requester_user from created_by and names unmapped rows', () => {
    assert.match(sql, /requester_user = created_by/)
    assert.match(sql, /created_by IS NULL/)
    assert.match(sql, /restrict_violation/)
  })

  it('backfills requester_person nullable and keeps NULLs', () => {
    assert.match(sql, /requester_person = person/)
    assert.match(sql, /requester_person\s+uuid/)
    assert.doesNotMatch(sql, /requester_person SET NOT NULL/)
  })

  it('blocks apply on branch-NULL, reason-NULL/blank and split decision stamps', () => {
    assert.match(sql, /ALTER COLUMN branch SET NOT NULL/)
    assert.match(sql, /branch IS NULL/)
    assert.match(sql, /reason IS NULL/)
    assert.match(sql, /decided_by\/decided_at is NULL/)
  })

  it('refuses cancelled rows instead of silently dropping or rewriting them', () => {
    assert.match(sql, /status = 'cancelled'/)
    assert.match(sql, /has no[\s\S]{0,24}cancelled state/)
    assert.match(sql, /restrict_violation/)
  })

  it('requires the cutover shape (or 0052) and migrator ownership', () => {
    assert.match(sql, /directus_migrator/)
    assert.match(sql, /only an owner may reshape it/)
    assert.match(sql, /matches neither/)
  })
})

describe('leave cutover — ADR-0012 shape (0067 §3–§5)', () => {
  const sql = sqlOf(MIGRATION)

  it('drops the stored day count (Mon–Fri compute owns used/remaining)', () => {
    assert.match(sql, /DROP COLUMN IF EXISTS days/)
    assert.match(sql, /DROP COLUMN IF EXISTS person/)
    assert.doesNotMatch(sql, /GRANT INSERT \([^)]*\bdays\b/)
    assert.doesNotMatch(sql, /GRANT INSERT \([^)]*[^_a-z]person[^_a-z]/)
  })

  it('maps maternity→other and declined→rejected, each with an audit note', () => {
    assert.match(sql, /leave_type = 'other'/)
    assert.match(sql, /WHERE leave_type = 'maternity'/)
    assert.match(sql, /status = 'rejected'/)
    assert.match(sql, /WHERE status = 'declined'/)
    assert.match(sql, /cutover 0067 \(D1\)/)
    assert.match(sql, /cutover 0067 \(D2\)/)
    assert.match(sql, /HR review sign-off required/)
  })

  it('pins the closed type/status sets and the audited CHECK names', () => {
    assert.match(
      sql,
      /leave_requests_type_allowed[\s\S]*?IN \('annual', 'sick', 'compassionate', 'study', 'unpaid', 'other'\)/,
    )
    assert.match(
      sql,
      /leave_requests_status_allowed[\s\S]*?IN \('pending', 'approved', 'rejected'\)/,
    )
    for (const c of [
      'leave_requests_dates_ordered',
      'leave_requests_decision_stamped_together',
      'leave_requests_type_allowed',
      'leave_requests_status_allowed',
      'leave_requests_reason_nonblank',
      'leave_request_events_type_allowed',
    ]) {
      assert.match(sql, new RegExp(c), `CHECK ${c} present`)
    }
  })

  it('creates the audit trail and backfills one created row per request', () => {
    assert.match(sql, /CREATE TABLE IF NOT EXISTS leave_request_events \(/)
    assert.match(sql, /event_type\s+text NOT NULL DEFAULT 'note'/)
    for (const e of ['created', 'updated', 'status_changed', 'note']) {
      assert.ok(sql.includes(`'${e}'`), `event_type includes ${e}`)
    }
    assert.match(sql, /cutover 0067 backfill: request filed pre-cutover/)
  })

  it('keeps Directus-owned ids as bare uuids (no FK onto the auth store)', () => {
    assert.match(read(MIGRATION), /stay bare uuids, no FK \(0037/)
    assert.doesNotMatch(sql, /FOREIGN KEY \(requester_user\)/)
    assert.doesNotMatch(sql, /FOREIGN KEY \(decided_by\)/)
    assert.doesNotMatch(sql, /FOREIGN KEY \(actor_user\)/)
  })

  it('grants no DELETE anywhere in the file', () => {
    assert.doesNotMatch(sql, /GRANT DELETE/i)
    assert.doesNotMatch(sql, /DELETE ON leave_requests/i)
    assert.doesNotMatch(sql, /DELETE ON leave_request_events/i)
    assert.match(sql, /REVOKE ALL ON leave_requests FROM PUBLIC/)
    assert.match(sql, /REVOKE ALL ON leave_request_events FROM PUBLIC/)
  })

  it('states CTO approval and the recorded degradation in the header', () => {
    const raw = read(MIGRATION)
    assert.match(raw, /CTO APPROVAL/)
    assert.match(raw, /ADR-0012/)
    assert.match(raw, /no independent security reviewer/)
  })

  it('keeps leave_balances and seeds no Directus policy rows', () => {
    assert.doesNotMatch(sql, /leave_balances/)
    assert.doesNotMatch(sql, /directus_permissions/)
  })
})

describe('leave cutover — rollback', () => {
  const down = sqlOf(DOWN)

  it('refuses while either table holds rows', () => {
    assert.match(down, /leave_requests holds % row/)
    assert.match(down, /leave_request_events holds % row/)
    assert.match(down, /restrict_violation/)
  })

  it('drops child first, restores the 0052 shape, no CASCADE', () => {
    const childAt = down.indexOf('DROP TABLE IF EXISTS leave_request_events')
    const parentAt = down.indexOf('DROP TABLE IF EXISTS leave_requests')
    assert.ok(childAt !== -1 && parentAt !== -1, 'both drops present')
    assert.ok(childAt < parentAt, 'child drops first')
    assert.doesNotMatch(down, /CASCADE/)
    assert.match(down, /CREATE TABLE leave_requests \(/)
    assert.match(down, /GRANT DELETE ON leave_requests TO directus_app/)
  })
})

describe('leave cutover — shared (collections + matrix)', () => {
  const collections = codeOf('packages/shared/src/collections.ts')
  const matrix = codeOf('packages/shared/src/role-matrix.ts')

  it('registers both collections, keeps balances, and keeps them out of navigation', () => {
    assert.match(collections, /leaveRequests: 'leave_requests'/)
    assert.match(collections, /leaveRequestEvents: 'leave_request_events'/)
    assert.match(collections, /leaveBalances: 'leave_balances'/)
    const nav = read('packages/shared/src/collections.ts').match(
      /NAVIGABLE_COLLECTIONS = \[([\s\S]*?)\]/,
    )
    assert.ok(nav, 'navigable block found')
    assert.doesNotMatch(nav[1], /leaveRequests/)
  })

  it('grants deciding officers CRU and requesters create/read-own', () => {
    assert.match(matrix, /\[COLLECTIONS\.leaveRequests\]/)
    assert.match(matrix, /\[COLLECTIONS\.leaveRequestEvents\]/)
    const block = matrix.slice(matrix.indexOf('[COLLECTIONS.leaveRequests]'))
    assert.match(block, /branch_admin: \[CRU, 'own_branch'/)
    assert.match(block, /zone_admin: \[CRU, 'own_zone'\]/)
    assert.match(block, /area_admin: \[ALL, 'all'\]/)
    assert.match(block, /volunteer: \[CR, 'own_branch'/)
    assert.match(block, /department_leader: \[NONE, 'none'\]/)
  })

  it('restricts the reason field to deciding officers + area', () => {
    const fr = matrix.slice(matrix.indexOf('FIELD_RESTRICTIONS'))
    assert.ok(fr.includes('[COLLECTIONS.leaveRequests]'), 'leaveRequests has a restriction entry')
    assert.ok(fr.includes("'reason'"), 'reason is the restricted field')
  })

  it('does not widen any other grant (balances entries unchanged)', () => {
    const block = matrix.slice(matrix.indexOf('[COLLECTIONS.leaveBalances]'))
    const next = block.indexOf('[COLLECTIONS.', 1)
    const cell = next === -1 ? block : block.slice(0, next)
    assert.match(cell, /branch_admin: \[ALL, 'own_branch'\]/)
  })
})

describe('leave cutover — routes (no DELETE, stamped create, vocab, mine, audit)', () => {
  it('removes the DELETE route on the audited register', () => {
    assert.throws(
      () => read('apps/web/server/api/leave-requests/[id].delete.ts'),
      /ENOENT/,
      'no DELETE route file ships with the cutover',
    )
    const patch = codeOf('apps/web/server/api/leave-requests/[id].patch.ts')
    assert.doesNotMatch(patch, /deleteItem/)
    const post = codeOf('apps/web/server/api/leave-requests/index.post.ts')
    assert.doesNotMatch(post, /deleteItem/)
  })

  it('stamps requester_user server-side with no client days on create', () => {
    const post = codeOf('apps/web/server/api/leave-requests/index.post.ts')
    assert.match(post, /requester_user: scope\.session\.user\.id/)
    assert.doesNotMatch(post, /person: form\.person/)
    assert.doesNotMatch(post, /\bdays\b/)
    assert.match(post, /'created'/)
    assert.match(post, /COLLECTIONS\.leaveRequestEvents/)
  })

  it('pins the pending/approved/rejected vocab and the mine filter on list', () => {
    const list = codeOf('apps/web/server/api/leave-requests/index.get.ts')
    assert.match(list, /query\.mine === '1'/)
    assert.match(list, /requester_user: \{ _eq: scope\.session\.user\.id \}/)
    assert.doesNotMatch(list, /person: \{ _eq/)
    assert.doesNotMatch(list, /'declined'/)
    assert.doesNotMatch(list, /'cancelled'/)
  })

  it('audits both PATCH paths and gates them (pending-only, requester-only, update-grant)', () => {
    const patch = codeOf('apps/web/server/api/leave-requests/[id].patch.ts')
    assert.match(patch, /not_pending/)
    assert.match(patch, /not_requester/)
    assert.match(patch, /COLLECTIONS\.leaveRequests, 'update'/)
    assert.ok(patch.includes(`'updated'`), 'edit path audits updated')
    assert.ok(patch.includes(`'status_changed'`), 'decision path audits status_changed')
  })

  it('blocks self-decision on the decision path (AFC-1067 separation of duties)', () => {
    const patch = codeOf('apps/web/server/api/leave-requests/[id].patch.ts')
    assert.match(patch, /not_own_decision/)
    assert.match(patch, /row\.requester_user === scope\.session\.user\.id/)
  })

  it('maps maternity→other and blocks cancelled at the migration, not the route', () => {
    const post = codeOf('apps/web/server/api/leave-requests/index.post.ts')
    const edit = codeOf('packages/shared/src/schemas/office.ts')
    assert.doesNotMatch(post, /maternity/)
    assert.doesNotMatch(edit, /'maternity'/)
    const mig = sqlOf(MIGRATION)
    assert.match(mig, /WHERE leave_type = 'maternity'/)
  })
})
