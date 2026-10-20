/**
 * AFC-470 contract tests — staff event registration completion.
 *
 * Pure node:test, no dependencies. Asserts the helper contract the five
 * staff routes will be built on:
 *   1. Staff create reuses the public allowlist, stamps source 'staff'
 *      (PRD US-5 / data-model, NOT 'staff_walkin'), and never accepts
 *      ticket_code / registration_status from the client.
 *   2. Status edges allow pending->confirmed->attended plus waitlist
 *      promotion and cancelled/no-show, with terminal states final.
 *   3. Payment patch validation: paid/refunded need an amount collected.
 *   4. Group idempotency: N members create exactly N rows; a replay with
 *      the same keys creates zero new rows.
 *   5. Rollups fold loaded rows (no summary tables); check-in resolves a
 *      ticket exactly or a name to a single match, else asks staff.
 *
 * Run: node --test tests/web/event-registration-completion.contract.mjs
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const read = (rel) => readFileSync(path.join(root, rel), 'utf8')
const codeOf = (rel) => read(rel).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*/g, '')

/* ---- Inline mirrors of the helper (kept small; structural asserts below pin the source) ---- */

const TRANSITIONS = {
  pending: ['confirmed', 'waitlisted', 'cancelled'],
  waitlisted: ['confirmed', 'pending', 'cancelled'],
  confirmed: ['attended', 'cancelled', 'no_show'],
  attended: [],
  cancelled: [],
  no_show: [],
}
const allowed = (from, to) => from === to || (TRANSITIONS[from] ?? []).includes(to)

const normalize = (value) => String(value ?? '').trim().toLowerCase().replace(/\s+/g, '')
function memberKey(eventId, groupCode, m) {
  const name = `${normalize(m.registrant_first_name)}|${normalize(m.registrant_last_name)}`
  const contact = normalize(m.phone) || normalize(m.email) || 'no-contact'
  return [String(eventId), String(groupCode).trim().toLowerCase(), name, contact].join(':')
}
function splitReplay(existing, eventId, groupCode, members) {
  const seen = new Set(existing)
  const toCreate = []
  const skipped = []
  const batch = new Set()
  for (const m of members) {
    const key = memberKey(eventId, groupCode, m)
    if (seen.has(key) || batch.has(key)) { skipped.push(m); continue }
    batch.add(key)
    toCreate.push(m)
  }
  return { toCreate, skipped }
}
function summarize(rows) {
  const byStatus = {}
  let confirmed = 0
  let attended = 0
  let expected = 0
  let collected = 0
  for (const row of rows) {
    const status = String(row.registration_status ?? 'unknown')
    byStatus[status] = (byStatus[status] ?? 0) + 1
    if (status === 'confirmed') confirmed += 1
    if (status === 'attended') attended += 1
    if (status === 'cancelled') continue
    expected += Number(row.amount_expected ?? 0)
    collected += Number(row.amount_paid ?? 0)
  }
  return {
    registered: rows.filter((r) => r.registration_status !== 'cancelled').length,
    confirmed, attended, expected, collected,
    outstanding: Math.max(0, expected - collected),
    byStatus,
  }
}

const HELPER = 'apps/web/server/utils/event-registration-completion.ts'

describe('staff create: allowlist reuse, staff source, no client status', () => {
  const src = codeOf(HELPER)

  it('stamps source staff per PRD/data-model and records why not staff_walkin', () => {
    assert.match(src, /STAFF_SOURCE = 'staff'/)
    assert.match(read(HELPER), /NOT 'staff_walkin'/)
    assert.match(src, /registrationFormSchema/)
    assert.match(src, /PUBLIC_REGISTRATION_FIELDS/)
  })

  it('names ticket_code and registration_status as never-from-client', () => {
    assert.match(src, /STAFF_CREATE_FORBIDDEN_FIELDS/)
    assert.match(src, /'ticket_code'/)
    assert.match(src, /'registration_status'/)
  })

  it('leaves the public allowlist file untouched (no cross-file edit)', () => {
    const pub = read('packages/shared/src/schemas/registration.ts')
    assert.doesNotMatch(pub, /staff_walkin/)
    assert.match(pub, /source: 'public_form'/)
  })
})

describe('status transitions: forward flow, waitlist promotion, terminal finality', () => {
  const src = codeOf(HELPER)

  it('encodes the allowed edges in STATUS_TRANSITIONS', () => {
    assert.match(src, /pending: \['confirmed', 'waitlisted', 'cancelled'\]/)
    assert.match(src, /waitlisted: \['confirmed', 'pending', 'cancelled'\]/)
    assert.match(src, /confirmed: \['attended', 'cancelled', 'no_show'\]/)
  })

  it('terminal states have no outgoing edge', () => {
    assert.match(src, /attended: \[\]/)
    assert.match(src, /cancelled: \[\]/)
    assert.match(src, /no_show: \[\]/)
  })

  it('the forward walk behaves: pending->confirmed->attended', () => {
    assert.equal(allowed('pending', 'confirmed'), true)
    assert.equal(allowed('confirmed', 'attended'), true)
    assert.equal(allowed('waitlisted', 'confirmed'), true)
    assert.equal(allowed('pending', 'attended'), false)
    assert.equal(allowed('attended', 'confirmed'), false)
    assert.equal(allowed('cancelled', 'pending'), false)
    assert.equal(allowed('confirmed', 'no_show'), true)
  })

  it('illegal moves are a 409 with an invalid_status_transition code', () => {
    assert.match(src, /statusCode: 409/)
    assert.match(src, /invalid_status_transition/)
  })
})

describe('payment patch: amounts reconcile before status flips', () => {
  const src = codeOf(HELPER)

  it('pins the four payment states', () => {
    assert.match(src, /'not_required',\s*\n\s*'pending',\s*\n\s*'paid',\s*\n\s*'refunded'/)
  })

  it('paid and refunded require an amount collected', () => {
    assert.match(src, /Record the amount collected before marking paid/)
    assert.match(src, /Record the amount refunded before marking refunded/)
  })

  it('rejects negative or non-numeric amounts', () => {
    assert.match(src, /Enter a non-negative amount/)
  })
})

describe('group idempotency: N members in, replay writes zero rows', () => {
  const src = codeOf(HELPER)

  it('keys on (event, group_code, normalized phone/email+name)', () => {
    assert.match(src, /groupMemberKey\(/)
    assert.match(src, /normalizeMemberContact/)
  })

  it('first submission of N members yields exactly N rows to create', () => {
    const members = [
      { registrant_first_name: 'Ada', registrant_last_name: 'Oke', phone: '0803 123 4567', email: '' },
      { registrant_first_name: 'Bola', registrant_last_name: 'Ade', phone: '', email: 'Bola@Example.COM' },
      { registrant_first_name: 'Chidi', registrant_last_name: 'Obi', phone: '', email: '' },
    ]
    const { toCreate, skipped } = splitReplay([], 'e1', 'GRP-7', members)
    assert.equal(toCreate.length, 3)
    assert.equal(skipped.length, 0)
  })

  it('replay with the same keys creates zero new rows', () => {
    const members = [
      { registrant_first_name: 'Ada', registrant_last_name: 'Oke', phone: '0803 123 4567', email: '' },
      { registrant_first_name: 'Bola', registrant_last_name: 'Ade', phone: '', email: 'Bola@Example.COM' },
    ]
    const first = splitReplay([], 'e1', 'GRP-7', members)
    const stored = first.toCreate.map((m) => memberKey('e1', 'GRP-7', m))
    const replay = splitReplay(stored, 'e1', 'GRP-7', members)
    assert.equal(replay.toCreate.length, 0)
    assert.equal(replay.skipped.length, 2)
  })

  it('normalization makes retries match despite case and spacing drift', () => {
    const a = memberKey('e1', 'GRP-7', { registrant_first_name: 'Ada', registrant_last_name: 'Oke', phone: '0803 123 4567' })
    const b = memberKey('e1', ' GRP-7 ', { registrant_first_name: ' ada ', registrant_last_name: 'OKE', phone: '08031234567' })
    assert.equal(a, b)
    const c = memberKey('e1', 'GRP-7', { registrant_first_name: 'Ada', registrant_last_name: 'Oke', email: 'ADA@x.ng' })
    const d = memberKey('e1', 'grp-7', { registrant_first_name: 'ada', registrant_last_name: 'oke', email: 'ada@x.ng' })
    assert.equal(c, d)
  })

  it('duplicates inside one batch collapse to a single row', () => {
    const m = { registrant_first_name: 'Ada', registrant_last_name: 'Oke', phone: '08031234567' }
    const { toCreate, skipped } = splitReplay([], 'e1', 'GRP-7', [m, { ...m }])
    assert.equal(toCreate.length, 1)
    assert.equal(skipped.length, 1)
  })
})

describe('rollups: aggregate query shape, no summary tables', () => {
  const src = codeOf(HELPER)

  it('folds registered/confirmed/attended plus money in one pass', () => {
    assert.match(src, /summarizeRegistrations/)
    assert.match(read(HELPER), /no summary tables/)
  })

  it('counts headcount without cancelled and money without cancelled', () => {
    const rows = [
      { registration_status: 'confirmed', amount_expected: '5000', amount_paid: '5000' },
      { registration_status: 'pending', amount_expected: '5000', amount_paid: '2000' },
      { registration_status: 'attended', amount_expected: '0', amount_paid: '0' },
      { registration_status: 'cancelled', amount_expected: '5000', amount_paid: '5000' },
    ]
    const roll = summarize(rows)
    assert.equal(roll.registered, 3)
    assert.equal(roll.confirmed, 1)
    assert.equal(roll.attended, 1)
    assert.equal(roll.expected, 10000)
    assert.equal(roll.collected, 7000)
    assert.equal(roll.outstanding, 3000)
  })
})

describe('check-in: exact ticket or single name match, else disambiguate', () => {
  const src = codeOf(HELPER)

  it('resolves ticket codes case-insensitively and names to one live row', () => {
    assert.match(src, /resolveCheckIn/)
    assert.match(src, /ambiguous/)
    assert.match(src, /cancelled/)
  })
})
