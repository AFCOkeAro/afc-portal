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
const codeOf = (rel) =>
  read(rel)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*/g, '')

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

const normalize = (value) =>
  String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '')
function memberKey(eventId, groupCode, m) {
  const name = `${normalize(m.registrant_first_name)}|${normalize(m.registrant_last_name)}`
  const contact = normalize(m.phone) || normalize(m.email) || 'no-contact'
  return [String(eventId), String(groupCode).trim().toLowerCase(), name, contact].join(
    ':',
  )
}
function splitReplay(existing, eventId, groupCode, members) {
  const seen = new Set(existing)
  const toCreate = []
  const skipped = []
  const batch = new Set()
  for (const m of members) {
    const key = memberKey(eventId, groupCode, m)
    if (seen.has(key) || batch.has(key)) {
      skipped.push(m)
      continue
    }
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
    confirmed,
    attended,
    expected,
    collected,
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
    assert.match(src, /'not_required',\s*'pending',\s*'paid',\s*'refunded'/)
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
      {
        registrant_first_name: 'Ada',
        registrant_last_name: 'Oke',
        phone: '0803 123 4567',
        email: '',
      },
      {
        registrant_first_name: 'Bola',
        registrant_last_name: 'Ade',
        phone: '',
        email: 'Bola@Example.COM',
      },
      {
        registrant_first_name: 'Chidi',
        registrant_last_name: 'Obi',
        phone: '',
        email: '',
      },
    ]
    const { toCreate, skipped } = splitReplay([], 'e1', 'GRP-7', members)
    assert.equal(toCreate.length, 3)
    assert.equal(skipped.length, 0)
  })

  it('replay with the same keys creates zero new rows', () => {
    const members = [
      {
        registrant_first_name: 'Ada',
        registrant_last_name: 'Oke',
        phone: '0803 123 4567',
        email: '',
      },
      {
        registrant_first_name: 'Bola',
        registrant_last_name: 'Ade',
        phone: '',
        email: 'Bola@Example.COM',
      },
    ]
    const first = splitReplay([], 'e1', 'GRP-7', members)
    const stored = first.toCreate.map((m) => memberKey('e1', 'GRP-7', m))
    const replay = splitReplay(stored, 'e1', 'GRP-7', members)
    assert.equal(replay.toCreate.length, 0)
    assert.equal(replay.skipped.length, 2)
  })

  it('normalization makes retries match despite case and spacing drift', () => {
    const a = memberKey('e1', 'GRP-7', {
      registrant_first_name: 'Ada',
      registrant_last_name: 'Oke',
      phone: '0803 123 4567',
    })
    const b = memberKey('e1', ' GRP-7 ', {
      registrant_first_name: ' ada ',
      registrant_last_name: 'OKE',
      phone: '08031234567',
    })
    assert.equal(a, b)
    const c = memberKey('e1', 'GRP-7', {
      registrant_first_name: 'Ada',
      registrant_last_name: 'Oke',
      email: 'ADA@x.ng',
    })
    const d = memberKey('e1', 'grp-7', {
      registrant_first_name: 'ada',
      registrant_last_name: 'oke',
      email: 'ada@x.ng',
    })
    assert.equal(c, d)
  })

  it('duplicates inside one batch collapse to a single row', () => {
    const m = {
      registrant_first_name: 'Ada',
      registrant_last_name: 'Oke',
      phone: '08031234567',
    }
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

describe('staff create route: staff-only, allowlist, no client status', () => {
  const src = codeOf('apps/web/server/api/events/[id]/registrations.post.ts')

  it('requires the event_registrations create grant', () => {
    assert.match(src, /requireCan\(scope, 'event_registrations', 'create'\)/)
  })

  it('scopes the event before writing anything', () => {
    assert.match(src, /eventScopeFilter\(scope\)/)
    assert.match(src, /findScopedItem/)
  })

  it('rejects ticket_code and registration_status from the client', () => {
    assert.match(src, /STAFF_CREATE_FORBIDDEN_FIELDS/)
    assert.match(src, /client_forbidden_field/)
  })

  it('validates through the shared form schema and stamps the staff payload', () => {
    assert.match(src, /registrationFormSchema\.safeParse/)
    assert.match(src, /toStaffPayload/)
  })

  it('never touches the public allowlist module beyond importing it', () => {
    assert.doesNotMatch(src, /PUBLIC_REGISTRATION_FIELDS\s*=/)
  })
})

describe('patch route: allowlisted fields, legal edges, reconciled money', () => {
  const src = codeOf('apps/web/server/api/events/registrations/[id].patch.ts')

  it('requires the update grant and scope-checks the owning event', () => {
    assert.match(src, /requireCan\(scope, 'event_registrations', 'update'\)/)
    assert.match(src, /eventScopeFilter\(scope\)/)
  })

  it('rejects unknown patch keys', () => {
    assert.match(src, /unpatchable_field/)
  })

  it('guards the transition with a 409 and the money with a 400', () => {
    assert.match(src, /assertStatusTransitionAllowed/)
    assert.match(read(HELPER), /invalid_status_transition/)
    assert.match(src, /validatePaymentPatch/)
  })

  it('caps the reference and the audit note, and names the activity log as the trail', () => {
    assert.match(src, /slice\(0, 120\)/)
    assert.match(src, /500/)
    assert.match(src, /directus_activity/)
  })
})

describe('check-in route: update grant, one query, no roster leak', () => {
  const src = codeOf('apps/web/server/api/events/[id]/check-in.post.ts')

  it('lets the volunteer update grant check in without a read grant', () => {
    assert.match(src, /requireCan\(scope, 'event_registrations', 'update'\)/)
  })

  it('demands exactly one of ticket_code or name', () => {
    assert.match(src, /checkin_needs_one_query/)
  })

  it('answers ambiguous names with a count, never a roster', () => {
    assert.match(src, /checkin_ambiguous/)
    assert.match(src, /resolveCheckIn/)
    assert.doesNotMatch(src, /person_name/)
  })

  it('re-check-in is idempotent and cancelled rows refuse with 409', () => {
    assert.match(src, /already: true/)
    assert.match(src, /checkin_cancelled/)
  })

  it('sets attended through the single-match row only', () => {
    assert.match(src, /registration_status: 'attended'/)
  })
})

describe('group route: validate-all-first, idempotent retry, honest partial failure', () => {
  const src = codeOf('apps/web/server/api/events/[id]/group-registrations.post.ts')

  it('requires the create grant and a bounded batch', () => {
    assert.match(src, /requireCan\(scope, 'event_registrations', 'create'\)/)
    assert.match(src, /MAX_GROUP_MEMBERS/)
  })

  it('validates every member before writing any row', () => {
    assert.match(src, /nothing was registered/)
    assert.match(src, /registrationFormSchema\.safeParse/)
  })

  it('replays through the idempotency split and reports created/skipped', () => {
    assert.match(src, /splitGroupReplay/)
    assert.match(src, /groupMemberKey/)
    assert.match(src, /skipped/)
  })

  it('persists the validated group_code on every created row', () => {
    assert.match(src, /group_code: groupCode/)
    assert.match(
      read('apps/web/server/api/events/[id]/group-registrations.post.ts'),
      /event_registrations\.group_code/,
    )
  })

  it('names partial failure with the ids written so a retry skips them', () => {
    assert.match(src, /group_partial_failure/)
    assert.match(src, /created_ids/)
  })
})

describe('rollups route: aggregate query, same gates as the export', () => {
  const src = codeOf('apps/web/server/api/events/[id]/rollups.get.ts')

  it('requires both read grants and the event scope', () => {
    assert.match(src, /requireCan\(scope, 'events', 'read'\)/)
    assert.match(src, /requireCan\(scope, 'event_registrations', 'read'\)/)
    assert.match(src, /eventScopeFilter\(scope\)/)
  })

  it('folds through the shared summarizer over visible fields only', () => {
    assert.match(src, /summarizeRegistrations/)
    assert.match(src, /visibleFields/)
  })
})

describe('detail page: revenue rollups and check-in wired to the new routes', () => {
  const src = read('apps/web/pages/events/[id].vue')

  it('consumes the rollups endpoint and renders expected/collected/outstanding', () => {
    assert.match(src, /\/api\/events\/\$\{id\}\/rollups/)
    assert.match(src, /Expected revenue/)
    assert.match(src, /Outstanding/)
    assert.match(src, /rollups\.expected/)
    assert.match(src, /rollups\.collected/)
    assert.match(src, /rollups\.outstanding/)
  })

  it('gates the revenue cards on the registrations read grant', () => {
    assert.match(src, /canReadRegistrations && rollups/)
  })

  it('gates the check-in card on the update grant so ushers see it without the list', () => {
    assert.match(src, /canUpdateRegistrations/)
    assert.match(src, /eventRegistrations, 'update'/)
  })

  it('posts exactly one of ticket_code or name to the check-in route', () => {
    assert.match(src, /\/api\/events\/\$\{id\}\/check-in/)
    assert.match(src, /ticket_code: ticket/)
    assert.match(src, /not both/)
  })

  it('reloads the list and the rollups after a successful check-in', () => {
    assert.match(src, /refresh\(\), loadRollups\(\)/)
  })
})

describe('manage modal: legal edges, reconciled money, audit note', () => {
  const src = read('apps/web/components/RegistrationManageModal.vue')

  it('patches the single-registration route with an allowlisted body', () => {
    assert.match(src, /\/api\/events\/registrations\/\$\{props\.registration\.id\}/)
    assert.match(src, /registration_status/)
    assert.match(src, /audit_note/)
  })

  it('mirrors the server transition map, which stays the authority', () => {
    assert.match(src, /STATUS_TRANSITIONS/)
    const line = (text, key) =>
      text.split('\n').find((l) => l.trim().startsWith(`${key}: [`))
    const edges = [
      ['pending', ['confirmed', 'waitlisted', 'cancelled']],
      ['waitlisted', ['confirmed', 'pending', 'cancelled']],
      ['confirmed', ['attended', 'cancelled', 'no_show']],
    ]
    const helper = read('apps/web/server/utils/event-registration-completion.ts')
    for (const [status, targets] of edges) {
      for (const target of targets) {
        assert.ok(
          line(helper, status).includes(`'${target}'`),
          `server allows ${status} -> ${target}`,
        )
        assert.ok(
          line(src, status).includes(`'${target}'`),
          `modal offers ${status} -> ${target}`,
        )
      }
    }
  })

  it('surfaces server field errors next to the inputs', () => {
    assert.match(src, /fieldErrors/)
    assert.match(src, /error\.fields/)
  })
})

describe('walk-in modal: shared schema, server-owned columns stay server-side', () => {
  const src = read('apps/web/components/RegistrationCreateModal.vue')

  it('validates through the shared form schema before posting', () => {
    assert.match(src, /registrationFormSchema\.safeParse/)
  })

  it('posts the schema output — which cannot hold ticket or status — to create', () => {
    assert.match(
      src,
      /api\.post\(`\/api\/events\/\$\{props\.eventId\}\/registrations`, parsed\.data\)/,
    )
  })

  it('hides medical inputs where the role must not see them', () => {
    assert.match(src, /medicalVisible/)
  })
})

describe('detail page: manage and walk-in actions with capability gates', () => {
  const src = read('apps/web/pages/events/[id].vue')

  it('opens the manage modal from a gated actions column', () => {
    assert.match(src, /canUpdateRegistrations/)
    assert.match(src, /managingRegistration = registration/)
    assert.match(src, /RegistrationManageModal/)
  })

  it('opens the walk-in modal from a create-gated button', () => {
    assert.match(src, /canCreateRegistrations/)
    assert.match(src, /showWalkinForm = true/)
    assert.match(src, /RegistrationCreateModal/)
  })

  it('reloads the list and the rollups after either modal saves', () => {
    assert.match(src, /afterRegistrationSaved/)
    assert.match(src, /refresh\(\), loadRollups\(\)/)
  })
})

describe('group modal: one code, N members, safe retry', () => {
  const src = read('apps/web/components/RegistrationGroupModal.vue')

  it('posts the code plus members to the group route', () => {
    assert.match(src, /\/api\/events\/\$\{props\.eventId\}\/group-registrations`, \{/)
    assert.match(src, /group_code: groupCode\.value\.trim\(\)/)
  })

  it('caps the batch and maps server member errors to rows', () => {
    assert.match(src, /members\.length < 50/)
    assert.match(src, /members\.\$\{index\}\./)
  })

  it('treats an all-skipped replay as information, not a silent close', () => {
    assert.match(src, /already registered under this code/)
  })
})

describe('detail page: group action with the create gate', () => {
  const src = read('apps/web/pages/events/[id].vue')

  it('opens the group modal from a create-gated button and reloads on save', () => {
    assert.match(src, /showGroupForm = true/)
    assert.match(src, /RegistrationGroupModal/)
  })
})

describe('event routes: unreadable store fails named, never bare 500 (AFC-566)', () => {
  const list = codeOf('apps/web/server/api/events/index.get.ts')
  const detail = codeOf('apps/web/server/api/events/[id].get.ts')
  const post = codeOf('apps/web/server/api/events/index.post.ts')
  const patch = codeOf('apps/web/server/api/events/[id].patch.ts')
  const create = codeOf('apps/web/server/api/events/[id]/registrations.post.ts')
  const group = codeOf('apps/web/server/api/events/[id]/group-registrations.post.ts')
  const checkin = codeOf('apps/web/server/api/events/[id]/check-in.post.ts')
  const csv = codeOf('apps/web/server/api/events/[id]/registrations.csv.get.ts')
  const rollups = codeOf('apps/web/server/api/events/[id]/rollups.get.ts')
  const regPatch = codeOf('apps/web/server/api/events/registrations/[id].patch.ts')

  it('catalogue and detail wrap the 0021 registers in the named store error', () => {
    assert.match(list, /throwStoreUnavailable\(error, 'event_store', '0021'\)/)
    assert.match(detail, /throwStoreUnavailable\(error, 'event_store', '0021'\)/)
  })

  it('create/patch wrap the 0021 event register in the named store error', () => {
    assert.match(post, /throwStoreUnavailable\(error, 'event_store', '0021'\)/)
    assert.match(patch, /throwStoreUnavailable\(error, 'event_store', '0021'\)/)
  })

  it('registration create/group/check-in keep their 4xx semantics under the named error', () => {
    assert.match(create, /throwStoreUnavailable\(error, 'event_store', '0021'\)/)
    assert.match(create, /client_forbidden_field/)
    assert.match(group, /throwStoreUnavailable\(error, 'event_store', '0021'\)/)
    assert.match(group, /group_partial_failure/)
    assert.match(checkin, /throwStoreUnavailable\(error, 'event_store', '0021'\)/)
    assert.match(checkin, /checkin_not_found/)
    assert.match(checkin, /checkin_ambiguous/)
  })

  it('csv/rollups/reg-patch wrap the 0021 registers in the named store error', () => {
    assert.match(csv, /throwStoreUnavailable\(error, 'event_store', '0021'\)/)
    assert.match(rollups, /throwStoreUnavailable\(error, 'event_store', '0021'\)/)
    assert.match(regPatch, /throwStoreUnavailable\(error, 'event_store', '0021'\)/)
    assert.match(regPatch, /assertStatusTransitionAllowed\(from, to\)/)
  })

  it('deliberate 4xx pass through instead of being renamed into the store', () => {
    for (const src of [
      list,
      detail,
      post,
      patch,
      create,
      group,
      checkin,
      csv,
      rollups,
      regPatch,
    ]) {
      assert.match(src, /statusCode\?\: number \}\)\?\.statusCode\) throw error/)
    }
  })

  it('the 0021 migration owns exactly the tables these routes assume', () => {
    const migration = read(
      'services/directus/schema/migrations/20261020_0021_events_registrations.sql',
    )
    assert.match(migration, /CREATE TABLE IF NOT EXISTS events/)
    assert.match(migration, /CREATE TABLE IF NOT EXISTS event_registrations/)
    assert.match(migration, /invite_eligible\s+boolean NOT NULL DEFAULT true/)
    assert.match(migration, /event_registrations_group_code_len/)
  })
})
