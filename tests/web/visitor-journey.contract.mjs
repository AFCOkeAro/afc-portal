/**
 * AFC-471 contract tests — newcomer journey: stages, follow-ups, funnel,
 * conversion + dedupe.
 *
 * Pure node:test, no dependencies. Asserts the helper contract the journey
 * routes are built on:
 *   1. Order guard: initial capture lands on identify; then exactly one
 *      step forward; skips, repeats, backward moves and unknown keys never
 *      advance.
 *   2. Pack gate: all six board-list items checked; drop-off gate: a real
 *      outcome recorded.
 *   3. Dedupe normalisation: +234/0-prefix phones match, emails match
 *      case-insensitively; either match warns, never merges.
 *   4. Funnel fold: per-stage counts, new-this-week, avg days, overdue past
 *      target_days, due-today/overdue per officer, unassigned-over-3d.
 *   5. Convert idempotency: an already-linked visitor returns the link and
 *      creates nothing (pinned structurally on the route source).
 *
 * Run: node --test tests/web/visitor-journey.contract.mjs
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

/* ---- Inline mirrors of packages/shared/src/schemas/visitor-journey.ts ---- */

const STAGES = ['identify', 'welcome', 'pack', 'dropoff', 'follow_up']
const TARGET_DAYS = { identify: 1, welcome: 1, pack: 2, dropoff: 7, follow_up: 60 }
const PACK_ITEMS = [
  'literature',
  'sermon_notes',
  'gift_bag',
  'malt',
  'biscuits',
  'contact_card',
]

const canAdvanceStage = (from, to) => {
  const toIndex = STAGES.indexOf(to)
  if (toIndex < 0) return false
  if (from === null || from === undefined) return toIndex === 0
  const fromIndex = STAGES.indexOf(from)
  if (fromIndex < 0) return false
  return toIndex === fromIndex + 1
}

const packComplete = (checklist, required = PACK_ITEMS) => {
  if (required.length === 0) return true
  if (!Array.isArray(checklist)) return false
  return required.every((item) => checklist.includes(item))
}

const dropoffComplete = (outcome) =>
  typeof outcome === 'string' && outcome.trim() !== '' && outcome !== 'pending'

const normalizePhone = (phone) => {
  if (!phone) return null
  const digits = String(phone).replace(/\D/g, '')
  if (!digits) return null
  const normalised = digits.startsWith('0') ? `234${digits.slice(1)}` : digits
  return normalised.length >= 10 ? normalised : null
}

const normalizeEmail = (email) => {
  if (!email) return null
  const normalised = String(email).trim().toLowerCase()
  return normalised.length > 0 ? normalised : null
}

function matchDuplicates(probe, candidates) {
  const phone = normalizePhone(probe.phone)
  const email = normalizeEmail(probe.email)
  if (!phone && !email) return []
  const hits = []
  for (const c of candidates) {
    const on = []
    if (phone && normalizePhone(c.phone) === phone) on.push('phone')
    if (email && normalizeEmail(c.email) === email) on.push('email')
    if (on.length > 0) hits.push({ id: c.id, matchedOn: on })
  }
  return hits
}

const DAY = 86_400_000
function buildFunnel(rows, now) {
  const stages = STAGES.map((key) => ({
    key,
    visitors: 0,
    newThisWeek: 0,
    days: [],
    overdue: 0,
  }))
  const officers = new Map()
  const today = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  )
  for (const row of rows) {
    const key = STAGES.includes(row.journey_stage) ? row.journey_stage : 'identify'
    const stage = stages.find((s) => s.key === key)
    stage.visitors += 1
    const entered = row.journey_stage_entered_at
      ? Date.parse(row.journey_stage_entered_at)
      : NaN
    if (!Number.isNaN(entered)) {
      const days = (now.getTime() - entered) / DAY
      if (days >= 0) {
        if (days <= 7) stage.newThisWeek += 1
        stage.days.push(days)
        if (days > TARGET_DAYS[key]) stage.overdue += 1
      }
    }
    const owner = row.follow_up_owner ?? null
    if (!officers.has(owner))
      officers.set(owner, { dueToday: 0, overdue: 0, unassignedOver3d: 0 })
    const stats = officers.get(owner)
    const checkIn = row.next_check_in_at ? Date.parse(row.next_check_in_at) : NaN
    if (!Number.isNaN(checkIn)) {
      const d = new Date(checkIn)
      if (
        Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) === today.getTime()
      ) {
        stats.dueToday += 1
      }
      if (checkIn < now.getTime()) stats.overdue += 1
    }
    if (!row.follow_up_owner && row.journey_started_at) {
      const started = Date.parse(`${row.journey_started_at}T00:00:00Z`)
      if (!Number.isNaN(started) && now.getTime() - started > 3 * DAY)
        stats.unassignedOver3d += 1
    }
  }
  return { stages, officers }
}

/* ---- 1. Order guard ---- */

describe('order guard: one step forward from identify, nothing else', () => {
  it('initial capture must land on identify', () => {
    assert.equal(canAdvanceStage(null, 'identify'), true)
    assert.equal(canAdvanceStage(undefined, 'identify'), true)
    assert.equal(canAdvanceStage(null, 'welcome'), false)
    assert.equal(canAdvanceStage(null, 'follow_up'), false)
  })

  it('each forward step of one advances', () => {
    assert.equal(canAdvanceStage('identify', 'welcome'), true)
    assert.equal(canAdvanceStage('welcome', 'pack'), true)
    assert.equal(canAdvanceStage('pack', 'dropoff'), true)
    assert.equal(canAdvanceStage('dropoff', 'follow_up'), true)
  })

  it('skips, repeats, backward moves and unknown keys never advance', () => {
    assert.equal(canAdvanceStage('identify', 'pack'), false)
    assert.equal(canAdvanceStage('welcome', 'welcome'), false)
    assert.equal(canAdvanceStage('dropoff', 'welcome'), false)
    assert.equal(canAdvanceStage('follow_up', 'identify'), false)
    assert.equal(canAdvanceStage('welcome', 'teleported'), false)
    assert.equal(canAdvanceStage('teleported', 'welcome'), false)
  })

  it('the source pins the same rule the SQL trigger enforces', () => {
    const helper = codeOf('packages/shared/src/schemas/visitor-journey.ts')
    assert.match(helper, /toIndex === fromIndex \+ 1/)
    assert.match(helper, /toIndex === 0/)
    const migration = read(
      'services/directus/schema/migrations/20261020_0008_visitor_journey.sql',
    )
    assert.match(migration, /journey_can_advance\(v_from_seq, v_to_seq\)/)
    assert.match(migration, /one step forward only/)
    const route = codeOf('apps/web/server/utils/visitor-journey.ts')
    assert.match(route, /canAdvanceStage\(fromKey, input\.toStage\)/)
  })
})

/* ---- 2. Pack + drop-off gates ---- */

describe('pack and drop-off gates', () => {
  it('pack needs all six board-list items', () => {
    assert.equal(packComplete([...PACK_ITEMS]), true)
    assert.equal(packComplete(PACK_ITEMS.slice(0, 5)), false)
    assert.equal(packComplete(null), false)
    assert.equal(packComplete('literature'), false)
    assert.equal(packComplete([], []), true)
  })

  it('drop-off needs a recorded outcome, not pending', () => {
    for (const outcome of [
      'address_confirmed',
      'moved',
      'not_home',
      'declined',
      'wrong_number',
    ]) {
      assert.equal(dropoffComplete(outcome), true)
    }
    assert.equal(dropoffComplete('pending'), false)
    assert.equal(dropoffComplete(null), false)
    assert.equal(dropoffComplete('  '), false)
  })

  it('the advance route gates pack and drop-off before writing the audit row', () => {
    const route = codeOf('apps/web/server/utils/visitor-journey.ts')
    assert.match(route, /pack_incomplete/)
    assert.match(route, /dropoff_outcome_required/)
    assert.match(route, /visitor_journey_transitions/)
    assert.match(route, /journey_stage_entered_at/)
  })
})

/* ---- 3. Dedupe warns, never merges ---- */

describe('duplicate detection warns on phone/email, never silent-merges', () => {
  const candidates = [
    { id: 'p1', phone: '+2348031112222', email: 'Ada@Example.COM' },
    { id: 'v9', phone: '08034445555', email: null },
  ]

  it('formatting variants of the same number match', () => {
    assert.deepEqual(
      matchDuplicates({ phone: '08031112222' }, candidates).map((h) => h.id),
      ['p1'],
    )
    assert.deepEqual(
      matchDuplicates({ phone: '2348031112222' }, candidates).map((h) => h.id),
      ['p1'],
    )
  })

  it('emails match case-insensitively', () => {
    assert.deepEqual(
      matchDuplicates({ email: 'ada@example.com' }, candidates).map((h) => h.id),
      ['p1'],
    )
  })

  it('no contact, no warning; unknown contact, no warning', () => {
    assert.deepEqual(matchDuplicates({}, candidates), [])
    assert.deepEqual(matchDuplicates({ phone: '08039998888' }, candidates), [])
  })

  it('the convert route returns duplicates and decides nothing by itself', () => {
    const route = codeOf('apps/web/server/api/visitors/convert.post.ts')
    assert.match(route, /duplicates/)
    assert.match(route, /already_converted/)
    assert.match(route, /mode === 'link'/)
    assert.doesNotMatch(route, /DELETE|delete/i)
  })
})

/* ---- 4. Funnel fold ---- */

describe('funnel: stage conversion, avg days, overdue and officer load', () => {
  const now = new Date('2026-10-20T12:00:00Z')
  const iso = (daysAgo) => new Date(now.getTime() - daysAgo * DAY).toISOString()
  const rows = [
    {
      journey_stage: 'identify',
      journey_stage_entered_at: iso(0.5),
      journey_started_at: '2026-10-19',
      follow_up_owner: null,
      next_check_in_at: null,
    },
    {
      journey_stage: 'welcome',
      journey_stage_entered_at: iso(3),
      journey_started_at: '2026-10-10',
      follow_up_owner: 'u1',
      next_check_in_at: '2026-10-20T09:00:00Z',
    },
    {
      journey_stage: 'welcome',
      journey_stage_entered_at: iso(10),
      journey_started_at: '2026-10-01',
      follow_up_owner: 'u1',
      next_check_in_at: '2026-10-18T09:00:00Z',
    },
    {
      journey_stage: null,
      journey_stage_entered_at: null,
      journey_started_at: '2026-10-01',
      follow_up_owner: null,
      next_check_in_at: null,
    },
  ]

  it('counts per stage with unknown stages falling back to identify', () => {
    const { stages } = buildFunnel(rows, now)
    assert.equal(stages.find((s) => s.key === 'identify').visitors, 2)
    assert.equal(stages.find((s) => s.key === 'welcome').visitors, 2)
    assert.equal(stages.find((s) => s.key === 'pack').visitors, 0)
  })

  it('new-this-week, overdue past target_days', () => {
    const { stages } = buildFunnel(rows, now)
    assert.equal(stages.find((s) => s.key === 'identify').newThisWeek, 1)
    // welcome target is 1 day: the 3-day and 10-day rows are both overdue.
    assert.equal(stages.find((s) => s.key === 'welcome').overdue, 2)
    assert.equal(stages.find((s) => s.key === 'identify').overdue, 0)
  })

  it('officer load: due today, overdue, unassigned over 3 days', () => {
    const { officers } = buildFunnel(rows, now)
    assert.equal(officers.get('u1').dueToday, 1)
    // Both u1 check-ins are past noon (today 09:00 and two days ago).
    assert.equal(officers.get('u1').overdue, 2)
    // Only the unassigned row started >3d ago counts (10-01; 10-19 is 1.5d).
    assert.equal(officers.get(null).unassignedOver3d, 1)
  })

  it('the funnel route folds loaded rows in scope and exports CSV', () => {
    const route = codeOf('apps/web/server/utils/visitor-journey.ts')
    assert.match(route, /buildJourneyFunnel/)
    assert.match(route, /scopeFilter/)
    const csv = codeOf('apps/web/server/api/visitors/funnel.csv.get.ts')
    assert.match(csv, /visitor-funnel\.csv/)
    assert.match(csv, /unassigned_over_3d/)
  })
})

/* ---- 5. Officer restriction is fail-closed ---- */

describe('officer assignment is restricted and fail-closed', () => {
  it('validation requires a branch Welfare appointment, no silent allow', () => {
    const route = codeOf('apps/web/server/utils/visitor-journey.ts')
    assert.match(route, /leadership_appointments/)
    assert.match(route, /officer_registry_unavailable/)
    assert.match(route, /officer_not_welfare/)
  })

  it('both assignment paths share the check', () => {
    assert.match(
      codeOf('apps/web/server/api/visitors/assign.post.ts'),
      /validateWelfareOfficer/,
    )
    assert.match(
      codeOf('apps/web/server/api/visitors/[id].patch.ts'),
      /validateWelfareOfficer/,
    )
  })
})
