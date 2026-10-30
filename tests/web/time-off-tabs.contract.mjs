/**
 * AFC-927 contract tests — Time Off tabs (Requests Mine/All, Approvals
 * gate, avatars, pending-row edit) over the AFC-930 register (ADR-0012).
 *
 * Pure node:test, no dependencies. Pins the vertical shape:
 *   1. List route defaults nothing server-side but honours `mine=1`
 *      (requester_user = session), stays branch-scoped, strips hidden
 *      fields, and resolves `requester_name` route-side (never a raw id
 *      in the UI).
 *   2. PATCH enforces pending-only, requester-only edits with ordered
 *      dates, update-grant decisions with session stamps, and audits
 *      both paths.
 *   3. The page defaults to Mine, gates Approvals on the update grant
 *      with a restricted notice (never the queue), renders names +
 *      avatars in both tabs, and edits pending rows only.
 *
 * Run: node --test tests/web/time-off-tabs.contract.mjs
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

const LIST = 'apps/web/server/api/leave-requests/index.get.ts'
const PATCH = 'apps/web/server/api/leave-requests/[id].patch.ts'
const PAGE = 'apps/web/pages/time-off/index.vue'
const AVATAR = 'apps/web/components/PersonAvatar.vue'
const SCHEMAS = 'packages/shared/src/schemas/office.ts'

describe('time off — shared leave schemas', () => {
  const schemas = codeOf(SCHEMAS)

  it('pins the leave vocabularies', () => {
    assert.match(schemas, /export const LEAVE_TYPES = \[/)
    for (const t of ['annual', 'sick', 'compassionate', 'study', 'unpaid', 'other']) {
      assert.ok(schemas.includes(`'${t}'`), `leave type includes ${t}`)
    }
    assert.match(schemas, /export const LEAVE_STATUSES = \['pending', 'approved', 'rejected'\]/)
    assert.match(schemas, /export const LEAVE_DECISIONS = \['approved', 'rejected'\]/)
  })

  it('separates requester edits from officer decisions', () => {
    assert.match(schemas, /export const leaveEditSchema/)
    assert.match(schemas, /export const leaveDecisionSchema/)
  })
})

describe('time off — list route', () => {
  const route = codeOf(LIST)

  it('requires the read grant and stays branch-scoped', () => {
    assert.match(route, /requireCan\(scope, COLLECTIONS\.leaveRequests, 'read'\)/)
    assert.match(route, /officeBranchScope\(scope\)/)
    assert.match(route, /stripHiddenMany\(scope, COLLECTIONS\.leaveRequests/)
  })

  it('honours mine=1 as requester_user = session', () => {
    assert.match(route, /query\.mine === '1'/)
    assert.match(route, /requester_user: \{ _eq: scope\.session\.user\.id \}/)
  })

  it('resolves the requester name route-side and marks editable rows', () => {
    assert.match(route, /requester_name/)
    assert.match(route, /COLLECTIONS\.people/)
    assert.match(route, /can_edit/)
    assert.match(route, /requester_photo: null/)
  })
})

describe('time off — PATCH route', () => {
  const route = codeOf(PATCH)

  it('is pending-only on both paths', () => {
    assert.match(route, /row\.status !== 'pending'/)
    assert.match(route, /not_pending/)
  })

  it('restricts edits to the requester and validates the date order', () => {
    assert.match(route, /row\.requester_user !== scope\.session\.user\.id/)
    assert.match(route, /not_requester/)
    assert.match(route, /leaveEditSchema\.safeParse/)
    assert.match(route, /invalid_dates/)
  })

  it('restricts decisions to the update grant with session stamps', () => {
    assert.match(route, /requireCan\(scope, COLLECTIONS\.leaveRequests, 'update'\)/)
    assert.match(route, /leaveDecisionSchema\.safeParse/)
    assert.match(route, /decided_by: scope\.session\.user\.id/)
    assert.match(route, /decided_at: now/)
  })

  it('audits both paths with the explicit trail', () => {
    assert.match(route, /COLLECTIONS\.leaveRequestEvents/)
    assert.ok(route.includes(`'updated'`), 'edit path audits updated')
    assert.ok(route.includes(`'status_changed'`), 'decision path audits status_changed')
  })
})

describe('time off — page', () => {
  const page = read(PAGE)
  const script = page.split('<template>')[0]
  const template = page.split('<template>').slice(1).join('<template>')

  it('defaults Requests to Mine with query-param sync', () => {
    assert.match(script, /queryParam\('mine'\) !== '0'/)
    assert.match(script, /mine: '1'/)
  })

  it('gates Approvals on the update grant with a restricted notice', () => {
    assert.match(script, /permissions\.can\(COLLECTIONS\.leaveRequests, 'update'\)/)
    assert.ok(template.includes('Restricted'), 'restricted notice renders without the grant')
    assert.ok(
      template.includes('deciding officers only'),
      'notice names the deciding-officer audience',
    )
  })

  it('renders names with avatars in both tabs and no raw ids', () => {
    assert.equal(
      template.match(/PersonAvatar/g)?.length ?? 0,
      2,
      'one PersonAvatar per tab',
    )
    assert.doesNotMatch(template, /requester_user/)
    assert.doesNotMatch(template, /requester_person/)
  })

  it('edits pending rows only, validates dates client-side, refreshes on save', () => {
    assert.match(template, /row\.can_edit/)
    assert.match(script, /start_date > .*end_date/)
    assert.match(script, /api\.patch\(`\/api\/leave-requests\//)
    assert.match(script, /refreshRequests\(\)/)
  })

  it('uses the avatar-with-initials component contract', () => {
    const avatar = read(AVATAR)
    assert.match(avatar, /:text=.*initials/)
    assert.match(avatar, /photo \?\? undefined/)
    assert.doesNotMatch(codeOf(AVATAR), /requester_user/)
  })
})
