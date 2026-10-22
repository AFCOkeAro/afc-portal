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
import { readFileSync } from 'node:fs'
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

  it('has search plus series and year filters and a scope pill', () => {
    assert.match(src, /Search by theme, name or code/)
    assert.match(src, /series/)
    assert.match(src, /yearOptions/)
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

  it('hero has back link, status pill, dates, scope and public link', () => {
    assert.match(src, /All programmes/)
    assert.match(src, /isUpcoming/)
    assert.match(src, /publicLink/)
    assert.match(src, /copyPublicLink/)
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
})

describe('registrations tab (§C): reference columns and bulk actions', () => {
  const src = read('apps/web/pages/events/[id].vue')

  it('columns are reg-no, name, phone, home church, registered, check-in', () => {
    assert.match(src, /Reg no/)
    assert.match(src, /Home church/)
    assert.match(src, /ticket_code/)
    assert.match(src, /branchNameOf/)
    assert.match(src, /Check-in/)
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

  it('schedule and materials are empty states with coordinator affordance', () => {
    assert.match(src, /No schedule yet/)
    assert.match(src, /No materials yet/)
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
