/**
 * AFC-930 contract tests — Time Off leave register backing.
 *
 * Pure node:test, no dependencies. Asserts the structural contract the
 * AFC-923 routes and AFC-927 frontend will build on:
 *   1. Schema: 0061 creates leave_requests + leave_request_events with the
 *      ADR-0012 field sets; ordered dates; decision stamps travel together;
 *      conditional FKs under fixed names; zone backfill; no DELETE grant.
 *   2. Rollback refuses while either table holds rows; child-first drop.
 *   3. Shared: collections entries (not navigable), matrix rows per
 *      ADR-0012 §Dec.4, reason field restriction per §Dec.3.
 *   4. Out of scope pins: no leave_balances table, no Directus policy seeding.
 *
 * Run: node --test tests/web/leave-requests.contract.mjs
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

const MIGRATION = 'services/directus/schema/migrations/20261030_0061_leave_requests.sql'
const DOWN = 'services/directus/schema/migrations/rollback/20261030_0061_leave_requests.down.sql'

describe('leave register — schema (ADR-0012 §Dec.1)', () => {
  const sql = sqlOf(MIGRATION)

  it('creates both tables idempotently', () => {
    assert.match(sql, /CREATE TABLE IF NOT EXISTS leave_requests \(/)
    assert.match(sql, /CREATE TABLE IF NOT EXISTS leave_request_events \(/)
  })

  it('carries the requester, type, dates, reason, status field set', () => {
    assert.match(sql, /requester_user\s+uuid NOT NULL/)
    assert.match(sql, /requester_person\s+uuid/)
    assert.match(sql, /leave_type\s+text NOT NULL/)
    for (const t of ['annual', 'sick', 'compassionate', 'study', 'unpaid', 'other']) {
      assert.ok(sql.includes(`'${t}'`), `leave_type includes ${t}`)
    }
    assert.match(sql, /start_date\s+date NOT NULL/)
    assert.match(sql, /end_date\s+date NOT NULL/)
    assert.match(sql, /reason\s+text NOT NULL/)
    assert.match(sql, /status\s+text NOT NULL DEFAULT 'pending'/)
    for (const s of ['pending', 'approved', 'rejected']) {
      assert.ok(sql.includes(`'${s}'`), `status includes ${s}`)
    }
  })

  it('orders the dates and stamps decisions together', () => {
    assert.match(sql, /CONSTRAINT leave_requests_dates_ordered/)
    assert.match(sql, /end_date >= start_date/)
    assert.match(sql, /CONSTRAINT leave_requests_decision_stamped_together/)
    assert.match(sql, /decided_by\s+uuid/)
    assert.match(sql, /decided_at\s+timestamptz/)
  })

  it('scopes by branch with zone denorm and backfills it', () => {
    assert.match(sql, /branch\s+uuid NOT NULL/)
    assert.match(sql, /zone\s+uuid/)
    assert.match(sql, /leave_requests_zone_fkey/)
    assert.match(sql, /backfilled from branch/)
  })

  it('audits explicitly with the transfer_events shape', () => {
    assert.match(sql, /leave_request\s+uuid NOT NULL REFERENCES leave_requests\(id\) ON DELETE CASCADE/)
    assert.match(sql, /event_type\s+text NOT NULL DEFAULT 'note'/)
    for (const e of ['created', 'updated', 'status_changed', 'note']) {
      assert.ok(sql.includes(`'${e}'`), `event_type includes ${e}`)
    }
  })

  it('keeps Directus-owned ids as bare uuids (no FK onto the auth store)', () => {
    assert.match(read(MIGRATION), /bare uuid, no\n--.*FK \(0037 precedent\)/)
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

  it('creates no leave_balances and seeds no Directus policy rows', () => {
    assert.doesNotMatch(sql, /leave_balances/)
    assert.doesNotMatch(sql, /directus_permissions/)
  })
})

describe('leave register — rollback', () => {
  const down = sqlOf(DOWN)

  it('refuses while either table holds rows', () => {
    assert.match(down, /leave_requests holds % row/)
    assert.match(down, /leave_request_events holds % row/)
    assert.match(down, /restrict_violation/)
  })

  it('drops child first without CASCADE', () => {
    const childAt = down.indexOf('DROP TABLE IF EXISTS leave_request_events')
    const parentAt = down.indexOf('DROP TABLE IF EXISTS leave_requests;')
    assert.ok(childAt !== -1 && parentAt !== -1, 'both drops present')
    assert.ok(childAt < parentAt, 'child drops first')
    assert.doesNotMatch(down, /CASCADE/)
  })
})

describe('leave register — shared (collections + matrix)', () => {
  const collections = codeOf('packages/shared/src/collections.ts')
  const matrix = codeOf('packages/shared/src/role-matrix.ts')

  it('registers both collections and keeps them out of navigation', () => {
    assert.match(collections, /leaveRequests: 'leave_requests'/)
    assert.match(collections, /leaveRequestEvents: 'leave_request_events'/)
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
})
