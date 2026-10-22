/**
 * AFC-679 contract tests — marriage phase D (notifications, calendar,
 * rehearsal gate).
 *
 * Static gates over the route layer (the DB suite 96 owns the CHECKs; this
 * suite owns the phase-D route rules a crafted HTTP request must not skip):
 *   1. Shared: notify channels + stage floors, schedule schema, announce
 *      schema caps.
 *   2. Notify: Music Director portal task at wedding_info; ministers draft
 *      mail at ministers_mail (send + consent stay with the existing
 *      communications machinery); once-per-case idempotency.
 *   3. Schedule: wedding/rehearsal dates without moving stage; 3-day lead
 *      re-checked with the {code, fields} shape.
 *   4. Announce: attire-check gate (stage floor + no-skip transition rule);
 *      exactly three pre-wedding Sundays; in-scope branches; wedding (+
 *      rehearsal) written to the calendar as events; once-per-case.
 *   5. Hygiene: scopeFilter/requireCan throughout; failure shape
 *      {code, fields}, no bare 500; brother/sister language only.
 *
 * Run: node --test tests/web/marriage-notifications.contract.mjs
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

const SHARED = 'packages/shared/src/schemas/office.ts'
const ROUTES = {
  notify: 'apps/web/server/api/marriage-cases/[id]/notify.post.ts',
  schedule: 'apps/web/server/api/marriage-cases/[id]/schedule.patch.ts',
  announce: 'apps/web/server/api/marriage-cases/[id]/announce.post.ts',
  transition: 'apps/web/server/api/marriage-cases/[id]/transition.post.ts',
}

describe('marriage phase D — shared notification/schedule/announce contract', () => {
  it('names the notify channels with their stage floors', () => {
    const src = codeOf(SHARED)
    assert.match(src, /MARRIAGE_NOTIFY_CHANNELS/, 'channel vocabulary exists')
    assert.match(src, /music_director/, 'music-director channel named')
    assert.match(src, /ministers/, 'ministers channel named')
    assert.match(src, /MARRIAGE_NOTIFY_STAGE_FLOOR/, 'stage-floor map exists')
    assert.match(src, /wedding_info/, 'music notice floors at wedding_info')
    assert.match(src, /ministers_mail/, 'ministers mail floors at ministers_mail')
    assert.match(src, /marriageCaseNotifySchema/, 'notify schema exists')
  })

  it('names the schedule and announce schemas with announce caps', () => {
    const src = codeOf(SHARED)
    assert.match(src, /marriageCaseScheduleSchema/, 'schedule schema exists')
    assert.match(src, /wedding_date/, 'schedule accepts the wedding date')
    assert.match(src, /rehearsal_date/, 'schedule accepts the rehearsal date')
    assert.match(src, /marriageCaseAnnounceSchema/, 'announce schema exists')
    assert.match(src, /branches/, 'announce accepts extra branches')
    assert.match(src, /publish_sundays/, 'announce accepts Sunday overrides')
  })
})

describe('marriage phase D — notify route', () => {
  it('floors each channel on the pipeline order index', () => {
    const src = codeOf(ROUTES.notify)
    assert.match(src, /MARRIAGE_FLOW_INDEX/, 'reads the order index')
    assert.match(src, /MARRIAGE_NOTIFY_STAGE_FLOOR/, 'reads the channel floors')
    assert.match(src, /Reach .* first/, 'early calls name the floor')
    assert.match(src, /validation_error/, 'named failure code')
    assert.match(src, /fields: \{[^}]*channel/, 'field-level failure shape')
  })

  it('notifies the Music Director with a portal task linked to the case', () => {
    const src = codeOf(ROUTES.notify)
    assert.match(
      src,
      /requireCan\(scope, 'tasks', 'create'\)/,
      'task creation is gated',
    )
    assert.match(src, /Music Director notified on portal/, 'trail prefix named')
    assert.match(src, /related_type: 'marriage_case'/, 'task links via related_type')
    assert.match(src, /related_id: id/, 'task links via related_id')
    assert.match(src, /event_type: 'note'/, 'notification is trailed')
  })

  it('mails ministers as a draft through the announcements table, send left to existing machinery', () => {
    const src = codeOf(ROUTES.notify)
    assert.match(
      src,
      /requireCan\(scope, 'announcements', 'create'\)/,
      'announcement creation is gated',
    )
    assert.match(src, /Ministers mailed ahead/, 'trail prefix named')
    assert.match(src, /channels: \['mail'\]/, 'mailed channel named')
    assert.match(src, /ministers/, 'ministers audience named')
    assert.match(src, /status: 'draft'/, 'filed as a draft, never sent here')
    assert.match(src, /suppression/, 'consent/suppression ownership stated')
  })

  it('notifies once per channel per case and refuses closed files', () => {
    const src = codeOf(ROUTES.notify)
    assert.match(src, /already_notified/, 'repeat notice code named')
    assert.match(src, /halted.*transferred_out.*reported/, 'closed vocabulary named')
    assert.match(src, /cannot notify again/, 'closed cases refuse')
  })
})

describe('marriage phase D — schedule route', () => {
  it('sets dates without moving the stage and re-checks the 3-day lead', () => {
    const src = codeOf(ROUTES.schedule)
    assert.match(src, /patch\.wedding_date/, 'wedding date patched')
    assert.match(src, /patch\.rehearsal_date/, 'rehearsal date patched')
    assert.match(src, /3 \* 24 \* 60 \* 60 \* 1000/, '3-day lead re-checked')
    assert.match(src, /validation_error/, 'named failure code')
    assert.match(src, /fields: \{[^}]*rehearsal_date/, 'field-level failure shape')
    assert.match(src, /cannot reschedule/, 'closed cases refuse')
    assert.match(src, /event_type: 'note'/, 'schedule change is trailed')
  })
})

describe('marriage phase D — announce route', () => {
  it('holds the attire-check gate at the stage floor', () => {
    const src = codeOf(ROUTES.announce)
    assert.match(src, /MARRIAGE_FLOW_INDEX/, 'reads the order index')
    assert.match(src, /announcements_calendar/, 'announcements floor named')
    assert.match(src, /attire check must pass/, 'gate refusal named')
    assert.match(src, /fields: \{[^}]*stage/, 'field-level failure shape')
  })

  it('refuses any skip over attire_check in the transition route', () => {
    const src = codeOf(ROUTES.transition)
    assert.match(src, /announcements_calendar/, 'announcements stage named')
    assert.match(src, /fromStage !== 'attire_check'/, 'arrival only from attire_check')
    assert.match(src, /attire check must pass/, 'gate refusal named')
  })

  it('requires the wedding date and exactly three pre-wedding Sundays', () => {
    const src = codeOf(ROUTES.announce)
    assert.match(src, /wedding_date: 'Set the wedding date first'/, 'dateless cases refuse')
    assert.match(src, /sundays\.length !== 3/, 'exactly three Sundays')
    assert.match(src, /getUTCDay\(\) === 0/, 'each day is a Sunday')
    assert.match(src, /publish_sundays.*not a pre-wedding Sunday/, 'Sunday check named')
  })

  it('announces across in-scope branches and writes the calendar events', () => {
    const src = codeOf(ROUTES.announce)
    assert.match(src, /branch_out_of_scope/, 'out-of-scope branches refused')
    assert.match(
      src,
      /requireCan\(scope, 'events', 'create'\)/,
      'calendar creation is gated',
    )
    assert.match(src, /Wedding service/, 'wedding calendar entry named')
    assert.match(src, /Wedding rehearsal/, 'rehearsal calendar entry named')
    assert.match(src, /Announcements written/, 'trail prefix named')
    assert.match(src, /already_announced/, 'repeat run code named')
  })
})

describe('marriage phase D — scoping, hygiene', () => {
  it('every phase-D route gates with requireCan and narrows with scopeFilter', () => {
    for (const [name, rel] of Object.entries(ROUTES)) {
      const src = codeOf(rel)
      assert.match(
        src,
        /requireCan\(scope, 'marriage_cases'/,
        `${name}: requireCan on marriage_cases`,
      )
      assert.match(
        src,
        /scopeFilter\(scope\)|officeZoneScope\(scope\)|resolveBranch\(scope/,
        `${name}: scoped read/write`,
      )
    }
  })

  it('every phase-D route names failure codes, never a bare 500', () => {
    for (const rel of Object.values(ROUTES)) {
      const src = read(rel)
      assert.match(src, /code: '/, `${rel}: named failure code`)
      assert.doesNotMatch(
        codeOf(rel),
        /throw new Error\(/,
        `${rel}: no bare Error (h3 renders 500)`,
      )
    }
  })

  it('no groom/bride language in the phase-D surface', () => {
    for (const rel of [...Object.values(ROUTES), SHARED]) {
      assert.doesNotMatch(codeOf(rel), /groom/i, `${rel}: brother/sister language only`)
      assert.doesNotMatch(codeOf(rel), /bride/i, `${rel}: brother/sister language only`)
    }
  })
})
