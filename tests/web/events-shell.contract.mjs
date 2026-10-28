/**
 * AFC-649 contract tests — events shell rebuild to the reference screenshots.
 *
 * Pure node:test, no dependencies. Pins:
 *   1. Failure shape: every events route maps an unreadable store to the
 *      named `event_store` error (never a bare 500); deliberate 4xx pass
 *      through. Previously-500 routes stay named-error shaped.
 *   2. Shell (§A): list renders Upcoming/Past card sections with search +
 *      series/year filters + scope pill; detail renders the hero (back
 *      link, status pill, public link) + the 6 tabs.
 *   3. Overview (§B): analytics fold client-side from scoped rows only —
 *      no new endpoint, no summary tables.
 *   4. Registrations (§C): reg-no/name/phone/home-church/registered/
 *      check-in columns, Export CSV, Add registrant, bulk select, all on
 *      existing fields.
 *   5. Check-in / Reports / Schedule / Materials (§D): session selector,
 *      scan + type/search modes, device list; report sub-tabs; empty
 *      states with coordinator affordance.
 *   6. Comms (§E): explicit opt-in per channel, quiet-hours note, caps,
 *      kill-switch gate, preview-before-confirm over the existing invites
 *      path, per-row result report. No new provider, no new send route.
 *   7. Visitors (§F): invite page + reports link to ?event=-scoped lists;
 *      visitors list honours ?event=.
 *   8. Mass registration (§G): branch-scoped EntitySelect batch, row-level
 *      error report, group_code idempotency; the no-single-transaction
 *      limit is stated, not hidden.
 *
 * Run: node --test tests/web/events-shell.contract.mjs
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const read = (rel) => readFileSync(path.join(root, rel), 'utf8')
const codeOf = (rel) =>
  read(rel)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*/g, '')

const ROUTES = [
  'apps/web/server/api/events/index.get.ts',
  'apps/web/server/api/events/[id].get.ts',
  'apps/web/server/api/events/[id].patch.ts',
  'apps/web/server/api/events/[id]/rollups.get.ts',
  'apps/web/server/api/events/[id]/check-in.post.ts',
  'apps/web/server/api/events/[id]/group-registrations.post.ts',
  'apps/web/server/api/events/[id]/registrations.post.ts',
  'apps/web/server/api/events/[id]/registrations.csv.get.ts',
  'apps/web/server/api/events/registrations/[id].patch.ts',
]

describe('failure shape: named store error, never a bare 500', () => {
  for (const route of ROUTES) {
    it(`${route} maps store failure to throwStoreUnavailable`, () => {
      assert.match(codeOf(route), /throwStoreUnavailable/)
      assert.match(codeOf(route), /event_store/)
    })

    it(`${route} contains no bare 500`, () => {
      assert.doesNotMatch(codeOf(route), /statusCode:\s*500/)
    })
  }

  it('group batch keeps its named partial-failure shape (502 with cause)', () => {
    const src = codeOf('apps/web/server/api/events/[id]/group-registrations.post.ts')
    assert.match(src, /group_partial_failure/)
    assert.match(src, /statusCode:\s*502/)
  })
})

describe('list shell (§A): Upcoming/Past cards, filters, scope pill', () => {
  const src = read('apps/web/pages/events/index.vue')

  it('renders Upcoming and Past card sections with counts', () => {
    assert.match(src, /Upcoming/)
    assert.match(src, /Past/)
    assert.match(src, /upcomingRows/)
    assert.match(src, /pastRows/)
  })

  it('has search plus series, year and status filters and a scope pill', () => {
    assert.match(src, /Search by theme, name or code/)
    assert.match(src, /series/)
    assert.match(src, /yearOptions/)
    assert.match(src, /statusOptions/)
    assert.match(src, /scopeLabel/)
  })

  it('series reuses event_type and year derives from start_at (no schema change)', () => {
    assert.match(src, /event_type/)
    assert.match(src, /eventYear/)
    assert.doesNotMatch(src, /series_id|programme_id/)
  })

  it('cards show registration state plus registered/checked-in counts', () => {
    assert.match(src, /registrationState/)
    assert.match(src, /registered_count/)
    assert.match(src, /attended_count/)
  })

  it('branch filter uses the searchable EntitySelect (no manual IDs)', () => {
    assert.match(src, /EntitySelect/)
  })
})

describe('detail shell (§A): hero plus 6 tabs', () => {
  const src = read('apps/web/pages/events/[id].vue')

  it('defines exactly the 6 reference tabs', () => {
    for (const tab of [
      'overview',
      'registrations',
      'checkin',
      'reports',
      'schedule',
      'materials',
    ]) {
      assert.match(src, new RegExp(`id: '${tab}'`))
    }
  })

  it('tabs deep-link through ?tab=', () => {
    assert.match(src, /route\.query\.tab/)
    assert.match(src, /goTab/)
  })

  it('hero has back link, status pill, dates, scope and event-scoped public link', () => {
    assert.match(src, /All programmes/)
    assert.match(src, /isUpcoming/)
    assert.match(src, /publicLink/)
    assert.match(src, /copyPublicLink/)
  })

  it('review fix 2: public link carries the event id, and register preselects it', () => {
    assert.match(src, /`\/register\?event=\$\{id\}`/)
    const register = read('apps/web/pages/register.vue')
    assert.match(register, /preselectedEvent/)
    assert.match(register, /form\.event = preselectedEvent/)
  })

  it('review fix 1: blessings count is labelled blessings, never unit reports', () => {
    assert.match(src, /label="Blessings linked"/)
    assert.doesNotMatch(src, /label="Unit reports"/)
  })

  it('review item 10: detail scope pill uses the list wording', () => {
    assert.match(src, /scopePill/)
    assert.match(src, /Showing all in your scope/)
    assert.doesNotMatch(src, /Whole scope in view/)
  })

  it('review item 9: tab and sub-tab buttons meet the touch target', () => {
    assert.match(src, /py-2\.5/)
  })

  it('coordinator status actions stay on the hero behind the update grant', () => {
    assert.match(src, /setStatus\('published'\)/)
    assert.match(src, /setStatus\('closed'\)/)
    assert.match(src, /setStatus\('cancelled'\)/)
    assert.match(src, /canEdit/)
  })
})

describe('overview (§B): scoped aggregates only, no new endpoint', () => {
  const src = codeOf('apps/web/pages/events/[id].vue')

  it('folds analytics from the loaded scoped rows (over-time, breakdowns, by-branch)', () => {
    assert.match(src, /overTime/)
    assert.match(src, /byAgeGroup/)
    assert.match(src, /byStatus/)
    assert.match(src, /byBranch/)
    assert.match(src, /byPayment/)
    assert.match(src, /bySource/)
  })

  it('adds no analytics endpoint — only the detail and rollups reads', () => {
    assert.match(src, /\/api\/events\/\$\{id\}\/rollups/)
    assert.doesNotMatch(
      src,
      /\/api\/events\/[^`'"]*(analytics|overview|summary|aggregate)/,
    )
  })

  it('every analytics block has an empty state', () => {
    assert.ok(
      (read('apps/web/pages/events/[id].vue').match(/EmptyState/g) ?? []).length >= 6,
    )
  })

  it('review item 5: chart endpoints labelled plus a screen-reader table', () => {
    assert.match(src, /overTime\[0\]\[0\]/)
    assert.match(src, /overTime\[overTime\.length - 1\]\[0\]/)
    assert.match(src, /sr-only/)
  })

  it('review item 4: data-blocked panels named, not silently dropped', () => {
    assert.match(src, /Breakdowns not shown/)
  })
})

describe('registrations tab (§C): reference columns and bulk actions', () => {
  const src = read('apps/web/pages/events/[id].vue')

  it('columns are reg-no, name, phone, branch, registered, check-in', () => {
    assert.match(src, /Reg no/)
    assert.match(src, />Branch</)
    assert.match(src, /ticket_code/)
    assert.match(src, /branchNameOf/)
    assert.match(src, /Check-in/)
  })

  it('review fix 3: no Home church header without a home-church field', () => {
    assert.doesNotMatch(src, /Home church/)
  })

  it('review item 8: checked-in filter plus newest-first sort', () => {
    assert.match(src, /regCheckin/)
    assert.match(src, /regSort/)
    assert.match(src, /Newest first/)
  })

  it('keeps Export CSV, Add registrant, group registration and bulk select', () => {
    assert.match(src, /registrations\.csv/)
    assert.match(src, /Add registrant/)
    assert.match(src, /Register group/)
    assert.match(src, /selectedRegs/)
    assert.match(src, /toggleAll/)
  })

  it('selection drives the comms modal', () => {
    assert.match(src, /EventCommsModal/)
    assert.match(src, /Message selected/)
  })
})

describe('check-in / reports / schedule / materials (§D)', () => {
  const src = read('apps/web/pages/events/[id].vue')

  it('check-in has session selector, scan + type modes and a device list', () => {
    assert.match(src, /checkinSession/)
    assert.match(src, /Arrival \(accreditation\)/)
    assert.match(src, /checkinMode/)
    assert.match(src, /deviceCheckins/)
  })

  it('review item 6: big number is the session total, device count is you', () => {
    assert.match(src, /event\.attended_count/)
    assert.match(src, /you: \{\{ deviceCheckins\.length \}\}/)
  })

  it('scanner degrades honestly to typed ticket codes (no fake camera)', () => {
    assert.match(src, /Camera scanning is not on this device/)
  })

  it('reports has the 4 reference sub-tabs with coordinator affordance', () => {
    assert.match(src, /Unit reports/)
    assert.match(src, /Feedback/)
    assert.match(src, /Blessings/)
    assert.match(src, /Testimonies/)
    assert.match(src, /No unit report form yet/)
  })

  it('schedule is a day-strip from the programme dates with an honest sessions note', () => {
    assert.match(src, /scheduleDays/)
    assert.match(src, /No timed sessions yet/)
    assert.match(src, /Open programme settings/)
  })
})

describe('comms (§E): gates over the existing invites path', () => {
  const src = read('apps/web/components/EventCommsModal.vue')

  it('requires explicit opt-in per channel before preview', () => {
    assert.match(src, /optWhatsapp/)
    assert.match(src, /optSms/)
    assert.match(src, /Opt in to at least one channel/)
  })

  it('shows quiet-hours, caps and kill-switch gates', () => {
    assert.match(src, /Quiet-hours/)
    assert.match(src, /invites\/quota/)
    assert.match(src, /hardening\/status/)
    assert.match(src, /killSwitchHeld/)
  })

  it('blocks sends while the kill switch holds or the cap is exhausted', () => {
    assert.match(src, /Messaging is paused by the kill switch/)
    assert.match(src, /daily invite cap is exhausted/)
  })

  it('sends only through invites preview + confirm with a per-row report', () => {
    assert.match(src, /invites\/preview/)
    assert.match(src, /api\/invites/)
    assert.match(src, /blocked_optout/)
    assert.match(src, /blocked_rate_limit/)
  })

  it('never defaults a minor band to adult; guardian gaps skip, never send', () => {
    assert.match(src, /never defaulted to adult/)
    assert.match(src, /without a guardian number/)
    assert.match(src, /guardianAttested/)
  })

  it('adds no new send route or provider', () => {
    assert.doesNotMatch(src, /\/api\/campaigns\/.*send|\/api\/communications\/.*send/)
  })
})

describe('visitors (§F): wired into invite page, reports and list', () => {
  it('invite page links to event-scoped visitors, invites and reports', () => {
    const src = read('apps/web/pages/events/[id]/invite.vue')
    assert.match(src, /visitors\?event=/)
    assert.match(src, /invites\?event=/)
    assert.match(src, /events\/.*\?tab=reports/)
  })

  it('detail reports tab links to invite, visitors and sent invitations', () => {
    const src = read('apps/web/pages/events/[id].vue')
    assert.match(src, /\/invite/)
    assert.match(src, /visitors\?event=/)
  })

  it('visitors list honours ?event= through the existing server filter', () => {
    const src = read('apps/web/pages/visitors/index.vue')
    assert.match(src, /eventFilter/)
    assert.match(src, /event: eventFilter/)
  })

  it('AFC-660: visitors server route parses ?event= inside the scope filter', () => {
    const src = codeOf('apps/web/server/api/visitors/index.get.ts')
    assert.match(src, /query\.event/)
    assert.match(src, /event:\s*\{\s*_eq:\s*eventId\s*\}/)
    assert.match(src, /scopeFilter\(scope\)/)
  })
})

describe('mass registration (§G): branch-scoped batch with error report', () => {
  const src = read('apps/web/components/RegistrationGroupModal.vue')

  it('batch branch uses EntitySelect, defaulting to the event branch', () => {
    assert.match(src, /EntitySelect/)
    assert.match(src, /branchOptions/)
    assert.match(src, /Event branch/)
  })

  it('branch travels per member through the validated schema', () => {
    assert.match(src, /branch: branch\.value \|\| undefined/)
  })

  it('failures render a row-level error report, not just a banner', () => {
    assert.match(src, /Row-level error report/)
    assert.match(src, /lastReport/)
    assert.match(src, /members\.\$\{index\}/)
  })

  it('states the no-single-transaction limit instead of hiding it', () => {
    assert.match(src, /no multi-row transaction/)
    assert.match(src, /group_partial_failure/)
  })
})

describe('PRD remainder sweep (§H): every events requirement line-by-line', () => {
  it('US-2 public registration: no-login form, row + ticket, minor guardian, capacity/waitlist', () => {
    const page = read('apps/web/pages/register.vue')
    assert.match(page, /registrationFormSchema/)
    assert.match(page, /ticket_code/)
    assert.match(page, /guardian_consent/)
    const route = read('apps/web/server/api/register.post.ts')
    assert.match(route, /ticket_code/)
    assert.match(route, /event_full/)
    assert.match(route, /waitlist_enabled/)
  })

  it('US-3 create/publish: required fields, own-branch, visibility, cancel/close, full filters', () => {
    const post = codeOf('apps/web/server/api/events/index.post.ts')
    assert.match(post, /eventFormSchema/)
    assert.match(post, /resolveBranch/)
    assert.match(post, /registration_open/)
    const list = read('apps/web/pages/events/index.vue')
    assert.match(list, /event_type/)
    assert.match(list, /statusOptions/)
    assert.match(list, /branchOptions/)
    assert.match(list, /upcomingRows/)
    assert.match(list, /pastRows/)
  })

  it('US-4 area oversight: cross-branch list, null-branch area-wide, edit guards', () => {
    const detail = codeOf('apps/web/server/api/events/[id].get.ts')
    assert.match(detail, /eventScopeFilter/)
    const patch = codeOf('apps/web/server/api/events/[id].patch.ts')
    assert.match(patch, /eventScopeFilter|requireCan/)
  })

  it('US-5 staff walk-in: staff source, status edges, manual money', () => {
    const util = read('apps/web/server/utils/event-registration-completion.ts')
    assert.match(util, /STAFF_SOURCE = 'staff'/)
    const create = codeOf('apps/web/server/api/events/[id]/registrations.post.ts')
    assert.match(create, /toStaffPayload/)
    assert.match(create, /registrationFormSchema/)
  })

  it('US-6 export: scoped CSV with medical gating', () => {
    const csv = codeOf('apps/web/server/api/events/[id]/registrations.csv.get.ts')
    assert.match(csv, /medical_notes|visibleFields/)
  })

  it('OQ-8: no online payment — money is recorded and reconciled manually', () => {
    const patch = codeOf('apps/web/server/api/events/registrations/[id].patch.ts')
    assert.match(patch, /amount_paid|payment_status/)
    assert.doesNotMatch(patch, /paystack|flutterwave|stripe|pay\/|checkout/i)
  })

  it('camp fields: guardian consent, medical and emergency contact collected', () => {
    const schema = read('packages/shared/src/schemas/registration.ts')
    assert.match(schema, /guardian_consent/)
    assert.match(schema, /medical_notes/)
    assert.match(schema, /emergency_contact/)
  })

  it('KNOWN GAP 1: target departments — events_departments junction exists but no route reads it', () => {
    const hit = []
    const walk = (dir) => {
      for (const name of readdirSync(dir)) {
        const full = path.join(dir, name)
        if (statSync(full).isDirectory()) walk(full)
        else if (
          full.endsWith('.ts') &&
          read(path.relative(root, full)).includes('events_departments')
        )
          hit.push(full)
      }
    }
    walk(path.join(root, 'apps/web/server'))
    assert.deepEqual(hit, [])
  })

  it('KNOWN GAP 2: no event-triggered email Flow (confirmation/reminder/follow-up)', () => {
    const flowsDir = path.join(root, 'services/directus/flows')
    const names = readdirSync(flowsDir).join('\n')
    assert.doesNotMatch(names, /event.*(confirm|remind|regist)/i)
  })
})

describe('AFC-867: active-programme parity (Happening now + Live + filters + day-strip)', () => {
  const list = read('apps/web/pages/events/index.vue')
  const detail = read('apps/web/pages/events/[id].vue')

  it('list partitions a Happening-now section client-side (no new endpoint)', () => {
    assert.match(list, /Happening now/)
    assert.match(list, /happeningNowRows/)
    assert.match(list, /isActive/)
    assert.doesNotMatch(
      codeOf('apps/web/pages/events/index.vue'),
      /\/api\/events\/[^`'"]*(active|live|happening)/,
    )
  })

  it('active cards and the detail hero carry the Live badge, not Upcoming/Past', () => {
    assert.match(list, /Live now/)
    assert.match(detail, /Live now/)
    assert.match(detail, /isActive/)
    assert.match(detail, /heroRegistration/)
  })

  it('registrations tab narrows by branch and age group on existing fields only', () => {
    assert.match(detail, /regBranch/)
    assert.match(detail, /regAgeGroup/)
    assert.match(detail, /regBranchOptions/)
    assert.match(detail, /regAgeGroupOptions/)
    assert.match(detail, /omitted rather than guessed/)
  })

  it('schedule renders a capped day-strip with a today marker', () => {
    assert.match(detail, /scheduleDays/)
    assert.match(detail, /days\.length < 31/)
    assert.match(detail, /Today/)
  })

  it('unfoldable reference panels stay named, not silent', () => {
    assert.match(detail, /Breakdowns not shown/)
    assert.match(detail, /check-ins-by-event/)
  })
})

describe('AFC-808: empty fee round-trips client -> server (moneySchema null-safe)', () => {
  const moneySrc = read('packages/shared/src/schemas/common.ts')

  it('moneySchema accepts null input, not just empty-string input', () => {
    const block = moneySrc.slice(moneySrc.indexOf('moneySchema'))
    assert.match(block, /z\.null\(\)/)
  })

  it('moneySchema normalises both empty string and null to null', () => {
    const block = moneySrc.slice(moneySrc.indexOf('moneySchema'))
    assert.match(block, /value === '' \|\| value === null \? null/)
  })

  it('moneySchema keeps the two-decimal-places message', () => {
    const block = moneySrc.slice(moneySrc.indexOf('moneySchema'))
    assert.match(block, /at most two places/)
  })

  it('moneySchema stays required-safe: undefined is not absorbed inside', () => {
    const block = moneySrc.slice(
      moneySrc.indexOf('moneySchema'),
      moneySrc.indexOf('optionalText'),
    )
    assert.doesNotMatch(block, /z\.undefined\(\)/)
  })

  it('client submit() posts parsed output, so the wire carries fee null', () => {
    const modal = read('apps/web/components/EventFormModal.vue')
    assert.match(modal, /eventFormSchema\.safeParse\(candidate\)/)
    assert.match(modal, /api\.post\('\/api\/events', parsed\.data\)/)
  })

  it('server create and patch re-parse the wire with the same eventFormSchema', () => {
    assert.match(
      codeOf('apps/web/server/api/events/index.post.ts'),
      /eventFormSchema\.safeParse\(/,
    )
    assert.match(
      codeOf('apps/web/server/api/events/[id].patch.ts'),
      /eventFormSchema\.safeParse\(/,
    )
  })

  it('free events still emit fee_amount null into the Directus payload', () => {
    const schema = read('packages/shared/src/schemas/event.ts')
    assert.match(schema, /fee_amount: form\.fee_amount/)
  })
})
