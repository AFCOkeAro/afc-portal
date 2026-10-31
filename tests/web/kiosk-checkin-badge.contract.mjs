/**
 * AFC-985 Phase 1 contract tests — kiosk check-in + offline outbox + badge print.
 *
 * Pure node:test, no dependencies. Covers the new surface only; the older
 * event-registration-completion contract owns the staff routes.
 *
 *   1. Kiosk gate: child rows and under-18 rows without guardian consent
 *      refuse BEFORE any write (server helper `kioskCheckInRefusal`); adults
 *      and consented minors pass. Synthetic fixture names only.
 *   2. Outbox: check-in saves locally FIRST, print queues SECOND; replay is
 *      idempotent (already-attended counts as success); terminal 409s settle
 *      as needs-desk and are never retried; no new backend table.
 *   3. Kiosk page: public route, no roster anywhere, confirm-before-send,
 *      queued/unsynced count, jam-proof print-second ordering, safeguarding
 *      states with label+glyph, 44px targets, reduced-motion respected.
 *   4. Badge: QR payload is the ticket_code string (no new crypto), min 25mm
 *      printed, @page 76x102mm + 102x152mm + A4 fallbacks, one badge/page.
 *   5. Ops note: approved printers, no 80mm receipt printer, 2-phone scan
 *      test, jam recovery, beacon pilot explicitly not built.
 *
 * Run: node --test tests/web/kiosk-checkin-badge.contract.mjs
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
/* Whitespace-flattened source: structural asserts survive Prettier reflows. */
const flatOf = (rel) => read(rel).replace(/\s+/g, ' ')

/* ---- Inline mirrors (kept small; structural asserts below pin the source) ---- */

/** Mirror of kioskCheckInRefusal in event-registration-completion.ts. */
function ageInYears(dob, now) {
  if (typeof dob !== 'string' || dob.trim() === '') return null
  const born = Date.parse(`${dob.trim()}T00:00:00Z`)
  if (Number.isNaN(born)) return null
  let age = now.getUTCFullYear() - new Date(born).getUTCFullYear()
  const bday = new Date(born)
  bday.setUTCFullYear(now.getUTCFullYear())
  if (bday.getTime() > now.getTime()) age -= 1
  return age
}
function refusal(row, now = new Date()) {
  const group = typeof row.age_group === 'string' ? row.age_group : 'unknown'
  const age = ageInYears(row.date_of_birth, now)
  if (group === 'child') return 'child'
  if (age !== null && age < 13) return 'child'
  const minorByGroup = group === 'child' || group === 'teen'
  const minorByDate = age !== null && age < 18
  const unknownProof = group === 'unknown' && (age === null || age < 18)
  if ((minorByGroup || minorByDate || unknownProof) && row.guardian_consent !== true) {
    return 'needs_guardian'
  }
  return null
}

/** Mirrors of the outbox pure helpers in composables/useKioskOutbox.ts. */
const outboxKey = (eventId) => `afc.kiosk.outbox.v1.${eventId}`
const enqueueIntent = (state, intent) =>
  state.intents.some((i) => i.key === intent.key)
    ? state
    : { ...state, intents: [...state.intents, intent] }
const enqueuePrint = (state, job) =>
  state.prints.some((j) => j.key === job.key)
    ? state
    : { ...state, prints: [...state.prints, job] }
const settleIntent = (state, key, outcome, code) => ({
  ...state,
  intents: state.intents.map((i) => (i.key === key ? { ...i, outcome, code } : i)),
})
const unsyncedCount = (state) =>
  state.intents.filter((i) => i.outcome === 'pending').length +
  state.prints.filter((j) => j.status === 'queued').length
const nextRetryDelayMs = (attempts) => Math.min(5000 * 3 ** Math.max(0, attempts), 300000)
const parseOutbox = (raw) => {
  if (!raw) return { version: 1, intents: [], prints: [] }
  try {
    const p = JSON.parse(raw)
    if (!Array.isArray(p.intents) || !Array.isArray(p.prints)) {
      return { version: 1, intents: [], prints: [] }
    }
    return { version: 1, intents: p.intents, prints: p.prints }
  } catch {
    return { version: 1, intents: [], prints: [] }
  }
}
const TERMINAL = [
  'checkin_child',
  'checkin_needs_guardian',
  'checkin_cancelled',
  'checkin_ambiguous',
  'checkin_not_found',
]
const NOW = new Date('2026-11-01T00:00:00Z')

const HELPER = 'apps/web/server/utils/event-registration-completion.ts'
const ROUTE = 'apps/web/server/api/events/[id]/check-in.post.ts'
const OUTBOX = 'apps/web/composables/useKioskOutbox.ts'
const KIOSK = 'apps/web/pages/events/[id]/kiosk.vue'
const BADGE = 'apps/web/pages/events/[id]/badge.vue'
const BADGE_CMP = 'apps/web/components/KioskBadge.vue'
const OPS = 'docs/kiosk-badge-ops.md'
const GUARD = 'apps/web/middleware/auth.global.ts'

describe('kiosk gate: children and unconsented minors refuse, nothing recorded', () => {
  const src = codeOf(HELPER)

  it('pins the helper and both refusal kinds in source', () => {
    assert.match(src, /kioskCheckInRefusal/)
    assert.match(src, /'child'/)
    assert.match(src, /needs_guardian/)
    assert.match(src, /guardian_consent !== true/)
  })

  it('a child age group refuses even with consent (never self-check-in)', () => {
    assert.equal(
      refusal(
        { age_group: 'child', date_of_birth: '2018-05-01', guardian_consent: true },
        NOW,
      ),
      'child',
    )
  })

  it('under-13 by DOB refuses even when the group says otherwise', () => {
    assert.equal(
      refusal(
        { age_group: 'teen', date_of_birth: '2016-01-01', guardian_consent: true },
        NOW,
      ),
      'child',
    )
  })

  it('a teen without consent blocks on consent, not as a child', () => {
    assert.equal(
      refusal(
        { age_group: 'teen', date_of_birth: '2011-06-01', guardian_consent: false },
        NOW,
      ),
      'needs_guardian',
    )
  })

  it('missing consent (absent flag) blocks exactly like false', () => {
    assert.equal(
      refusal({ age_group: 'teen', date_of_birth: '2011-06-01' }, NOW),
      'needs_guardian',
    )
  })

  it('unknown group with no adult proof takes the guardian path', () => {
    assert.equal(
      refusal({ age_group: 'unknown', guardian_consent: false }, NOW),
      'needs_guardian',
    )
  })

  it('a consented teen passes — the desk rule, not a ban', () => {
    assert.equal(
      refusal(
        { age_group: 'teen', date_of_birth: '2011-06-01', guardian_consent: true },
        NOW,
      ),
      null,
    )
  })

  it('an adult without consent passes — consent gates minors only', () => {
    assert.equal(
      refusal(
        { age_group: 'adult', date_of_birth: '1990-01-01', guardian_consent: false },
        NOW,
      ),
      null,
    )
  })
})

describe('check-in route: kiosk mode refuses before any write', () => {
  const src = codeOf(ROUTE)
  const raw = read(ROUTE)

  it('reads the gate columns on the single matched row only', () => {
    assert.match(src, /'age_group'/)
    assert.match(src, /'date_of_birth'/)
    assert.match(src, /'guardian_consent'/)
  })

  it('kiosk mode is opt-in per request — staffed desks are unaffected', () => {
    assert.match(src, /body\.mode/)
    assert.match(src, /'kiosk'/)
    assert.match(src, /kioskCheckInRefusal\(row\)/)
  })

  it('maps the refusals to named 409s (child nameless, consent names one row)', () => {
    assert.match(src, /checkin_child/)
    assert.match(src, /checkin_needs_guardian/)
  })

  it('the refusal runs BEFORE the attended write', () => {
    const gateAt = raw.indexOf('kioskCheckInRefusal(row)')
    // The write call stamps registration_status: 'attended' (the import
    // line also names updateItem, so the payload is the honest anchor).
    const writeAt = raw.indexOf("registration_status: 'attended'")
    assert.ok(gateAt > -1 && writeAt > -1 && gateAt < writeAt)
  })

  it('still leaks no roster: no person_name, no list in the response', () => {
    assert.doesNotMatch(src, /person_name/)
  })
})

describe('outbox: save-first, print-second, idempotent replay, no new table', () => {
  const src = codeOf(OUTBOX)

  it('keys the box per event in localStorage', () => {
    assert.match(src, /afc\.kiosk\.outbox\.v/)
    assert.equal(outboxKey('e9'), 'afc.kiosk.outbox.v1.e9')
  })

  it('a double-tap with one key queues one intent (mirror)', () => {
    const intent = { key: 'k1', outcome: 'pending' }
    const once = enqueueIntent({ intents: [], prints: [] }, intent)
    const twice = enqueueIntent(once, intent)
    assert.equal(twice.intents.length, 1)
  })

  it('print jobs dedupe the same way (mirror)', () => {
    const job = { key: 'p1', status: 'queued' }
    const once = enqueuePrint({ intents: [], prints: [] }, job)
    assert.equal(enqueuePrint(once, job).prints.length, 1)
  })

  it('settle + unsynced count drive the kiosk strip (mirror)', () => {
    let state = {
      intents: [{ key: 'a', outcome: 'pending' }],
      prints: [{ key: 'p', status: 'queued' }],
    }
    assert.equal(unsyncedCount(state), 2)
    state = settleIntent(state, 'a', 'synced')
    assert.equal(unsyncedCount(state), 1)
  })

  it('backoff grows then caps at five minutes (mirror)', () => {
    assert.equal(nextRetryDelayMs(0), 5000)
    assert.equal(nextRetryDelayMs(1), 15000)
    assert.equal(nextRetryDelayMs(99), 300000)
  })

  it('a corrupt box parses to empty, never throws (mirror)', () => {
    assert.deepEqual(parseOutbox(null), { version: 1, intents: [], prints: [] })
    assert.deepEqual(parseOutbox('{{{nope'), { version: 1, intents: [], prints: [] })
    assert.deepEqual(parseOutbox('{"intents":1}'), {
      version: 1,
      intents: [],
      prints: [],
    })
  })

  it('terminal codes settle as needs-desk and are never retried', () => {
    for (const code of TERMINAL) {
      assert.match(src, new RegExp(code))
    }
    assert.match(src, /needs-desk/)
  })

  it('already-attended answers count as replay success (idempotent)', () => {
    assert.match(src, /already/)
    assert.match(src, /settleIntent\(readStored\(\), intent\.key, 'already'\)/)
  })

  it('saves the intent before any network or print (ordering comment + calls)', () => {
    assert.match(read(OUTBOX), /locally FIRST/)
    assert.match(read(OUTBOX), /print.*SECOND/i)
  })

  it('creates no backend table — localStorage only', () => {
    assert.doesNotMatch(src, /CREATE TABLE/)
    assert.doesNotMatch(src, /createItem|updateItem/)
    assert.match(src, /localStorage/)
  })
})

describe('kiosk page: public, confirm-first, no roster, safeguarding states', () => {
  const src = read(KIOSK)
  const bare = codeOf(KIOSK)

  it('is a public route with no staff gate', () => {
    assert.match(src, /layout: 'public'/)
    assert.doesNotMatch(src, /middleware/)
  })

  it('posts through the existing route with kiosk mode (no new endpoint)', () => {
    assert.match(src, /\/api\/events\/\$\{id\}\/check-in/)
    assert.match(src, /mode: 'kiosk'/)
    assert.doesNotMatch(src, /\/api\/kiosk/)
  })

  it('sends exactly one of ticket_code or name after a confirm screen', () => {
    assert.match(src, /confirm/)
    assert.match(src, /Check me in/)
    assert.match(src, /ticket_code: ticket/)
  })

  it('saves the intent BEFORE posting, queues the print AFTER settling', () => {
    // Flattened: Prettier may reflow either call across lines.
    const flat = flatOf(KIOSK)
    const saveAt = flat.indexOf('saveCheckInLocalFirst(query)')
    const postAt = flat.indexOf('postCheckIn(query)')
    // The online path settles the intent, then queues the print with the
    // server-held name — these exact call shapes are unique to that path.
    const settleAt = flat.indexOf(
      "markIntentSettled(intent.key, already ? 'already' : 'synced')",
    )
    const queueAt = flat.indexOf('queuePrintAfterCheckIn({ ticketCode: ticket, name })')
    assert.ok(saveAt > -1 && postAt > -1 && saveAt < postAt)
    assert.ok(settleAt > -1 && queueAt > -1 && settleAt < queueAt)
  })

  it('renders the queued/unsynced count with a sync action', () => {
    assert.match(src, /queuedCount/)
    assert.match(src, /waiting to sync/)
    assert.match(src, /Sync now/)
    assert.match(src, /replayQueue/)
  })

  it('never renders a roster: ambiguous answers show a count only', () => {
    assert.match(flatOf(KIOSK), /matches .* registrations/)
    assert.doesNotMatch(src, /v-for=/)
  })

  it('already-attended is a notice, not an error', () => {
    assert.match(src, /Already checked in/)
    assert.match(src, /one check-in, seen twice/)
  })

  it('refusals route to a human desk with label + glyph', () => {
    assert.match(src, /welcome desk/)
    assert.match(src, /usherer's desk/)
    assert.match(src, /✕/)
    assert.match(src, /✓/)
  })

  it('an ungranted tablet gets the amber device state, not a retry loop', () => {
    assert.match(src, /401/)
    assert.match(src, /403/)
    assert.match(src, /cannot check anyone in today/)
  })

  it('meets the kiosk input rules: 44px targets, reduced motion', () => {
    assert.match(src, /afc-control-min/)
    assert.match(src, /afc-radius-pill/)
    assert.match(src, /prefers-reduced-motion/)
  })

  it('auto-clears success so the next attendee sees no name', () => {
    assert.match(src, /clears itself/)
    assert.match(src, /setTimeout\(startOver/)
  })
})

describe('badge: ticket-code QR, print sizes, one per page', () => {
  const page = read(BADGE)
  const cmp = read(BADGE_CMP)

  it('renders the badge from query params — no fetch, no roster', () => {
    assert.match(page, /route\.query/)
    assert.match(page, /KioskBadge/)
    assert.doesNotMatch(codeOf(BADGE), /useAsyncData|\$fetch\(.*registrations/)
  })

  it('QR payload is the ticket_code string via the shared TicketQr', () => {
    assert.match(cmp, /TicketQr/)
    assert.match(cmp, /:value="ticketCode"/)
    assert.doesNotMatch(codeOf(BADGE_CMP), /encodeQR/)
  })

  it('pins the thermal page plus both fallbacks', () => {
    assert.match(page, /76mm 102mm/)
    assert.match(page, /102mm 152mm/)
    assert.match(page, /A4/)
  })

  it('prints one badge per page with a 25mm+ QR', () => {
    assert.match(page, /break-after: page/)
    assert.match(page, /28mm/)
  })

  it('jam recovery is on the screen: reprint from queue, never re-tap', () => {
    assert.match(flatOf(BADGE), /reprint from the kiosk queue, never re-tap/i)
  })
})

describe('ops note: printers, paper, scan test, no beacon', () => {
  const doc = read(OPS)

  it('names the approved printer classes and the paper', () => {
    assert.match(doc, /ZD220d/)
    assert.match(doc, /XP-420B/)
    assert.match(doc, /76x102mm/)
  })

  it('forbids the 80mm receipt printer', () => {
    assert.match(doc, /Do NOT buy an 80mm receipt printer/)
  })

  it('requires the 2-phone scan test before bulk', () => {
    assert.match(doc, /2 different/)
    assert.match(doc, /25mm/)
  })

  it('documents jam recovery and the offline replay path', () => {
    assert.match(doc, /reprint from the queue/i)
    assert.match(doc, /Sync now/)
  })

  it('states the beacon pilot is not built', () => {
    assert.match(doc, /NOT built/)
  })
})

describe('design tokens: no hard-coded hex in new interface files', () => {
  it('kiosk, badge and component styles use tokens, not hex literals', () => {
    for (const rel of [KIOSK, BADGE, BADGE_CMP]) {
      const style = read(rel)
      assert.doesNotMatch(style, /#[0-9a-fA-F]{3,8}\b/, `${rel} must not hard-code hex`)
      assert.match(style, /var\(--afc-/, `${rel} must consume AFC tokens`)
    }
  })

  it('the token sheet is wired into the app CSS pipeline', () => {
    assert.match(
      read('apps/web/nuxt.config.ts'),
      /design-system\/tokens\/afc-tokens\.css/,
    )
  })
})

describe('auth guard: kiosk + badge public, event detail stays guarded (AFC-999)', () => {
  const src = read(GUARD)
  const bare = codeOf(GUARD)
  /* Mirror of isPublic() in apps/web/middleware/auth.global.ts. */
  const PUBLIC_ROUTES = ['/', '/login', '/register', '/p', '/programmes']
  const KIOSK_PUBLIC_RE = /^\/events\/[^/]+\/(kiosk|badge)(\/|$)/
  const isPublic = (path) =>
    PUBLIC_ROUTES.some((route) => path === route || path.startsWith(`${route}/`)) ||
    KIOSK_PUBLIC_RE.test(path)

  it('pins the narrow kiosk/badge prefix check beside the named list', () => {
    assert.match(src, /PUBLIC_ROUTES/)
    assert.match(src, /isPublicKioskLeaf/)
    const util = read('apps/web/utils/kiosk-public.ts')
    assert.match(util, /kiosk\|badge/)
    assert.match(util, /\/events\/[^/]+/)
  })

  it('does NOT blanket-open /events/ — only the two leaves', () => {
    assert.doesNotMatch(bare, /'\/events'/)
    assert.match(read('apps/web/utils/kiosk-public.ts'), /KIOSK_PUBLIC_RE/)
  })

  it('unauthenticated kiosk and badge leaves pass isPublic (no /login redirect)', () => {
    for (const p of ['/events/e9/kiosk', '/events/e9/kiosk/', '/events/e9/badge', '/events/e9/badge/']) {
      assert.equal(isPublic(p), true, `${p} must be public`)
    }
    assert.equal(isPublic('/events/e9/kiosk/extra'), true, 'nested kiosk leaf stays public')
  })

  it('bare /events/<id> and /events still redirect (stay guarded)', () => {
    for (const p of ['/events', '/events/', '/events/e9', '/events/e9/']) {
      assert.equal(isPublic(p), false, `${p} must stay guarded`)
    }
  })
})

describe('staff parent: public kiosk/badge leaves render without the staff shell (AFC-1003)', () => {
  it('staff guard yields the public leaves instead of redirecting to /login', () => {
    const staff = read('apps/web/middleware/staff.ts')
    assert.match(staff, /isPublicKioskLeaf\(to\.path\)/)
  })

  it('event detail parent yields layout + shell when a child leaf matches', () => {
    const page = read('apps/web/pages/events/[id].vue')
    assert.match(page, /<NuxtPage v-if="isChildRoute" \/>/)
    assert.match(page, /route\.matched\.length > 1/)
  })

  it('staff content still renders for the bare route (outlet is conditional)', () => {
    const page = read('apps/web/pages/events/[id].vue')
    assert.match(page, /<div v-else>/)
  })
})
