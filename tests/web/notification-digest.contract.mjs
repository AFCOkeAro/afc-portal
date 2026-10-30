/**
 * AFC-903 phase 1 contract — notification preferences + digest content.
 *
 * Phase 1 is store + content only: per-admin channel switches
 * (Email/Telegram/WhatsApp) + cadence (realtime/daily/weekly/monthly) +
 * digest sections built by reusing the existing report/rollup queries,
 * never by duplicating their business logic. No transport, no secrets.
 *
 * Run: node --test tests/web/notification-digest.contract.mjs
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import {
  DIGEST_CADENCES,
  DIGEST_SECTIONS,
  NOTIFICATION_CHANNELS,
  activityDigestSection,
  buildDigestContent,
  digestWindow,
  enabledChannels,
  isDigestCadence,
  shouldDeliver,
  tasksDigestSection,
  upcomingDigestSection,
  validatePreferences,
} from '../../packages/shared/src/notification-digest.ts'
import {
  combineCalendarFeed,
  isTaskOverdue,
} from '../../packages/shared/src/office-feed.ts'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const read = (rel) => readFileSync(path.join(root, rel), 'utf8')
const codeOf = (rel) =>
  read(rel)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*/g, '')

const SHARED = 'packages/shared/src/notification-digest.ts'
const SERVER = 'apps/web/server/utils/notification-digest.ts'
const MIGRATION =
  'services/directus/schema/migrations/20261030_0066_notification_preferences.sql'
const DOWN =
  'services/directus/schema/migrations/rollback/20261030_0066_notification_preferences.down.sql'

const goodPrefs = () => ({
  admin_user: 'user-1',
  email_enabled: true,
  telegram_enabled: false,
  whatsapp_enabled: true,
  cadence: 'weekly',
  sections: ['tasks', 'celebrations', 'events', 'activity'],
})

describe('preference validation fails closed', () => {
  it('accepts a well-formed preference row', () => {
    const parsed = validatePreferences(goodPrefs())
    assert.equal(parsed.ok, true)
  })

  it('refuses a blank admin, a bad cadence and an unknown section', () => {
    assert.equal(validatePreferences({ ...goodPrefs(), admin_user: '  ' }).ok, false)
    assert.equal(validatePreferences({ ...goodPrefs(), cadence: 'hourly' }).ok, false)
    assert.equal(
      validatePreferences({ ...goodPrefs(), sections: ['tasks', 'push'] }).ok,
      false,
    )
  })

  it('refuses non-boolean channel switches', () => {
    assert.equal(validatePreferences({ ...goodPrefs(), email_enabled: 'yes' }).ok, false)
  })

  it('allows an empty section list (header-only digest)', () => {
    const parsed = validatePreferences({ ...goodPrefs(), sections: [] })
    assert.equal(parsed.ok, true)
  })
})

describe('channels and the delivery gate', () => {
  it('lists the three channels and resolves the enabled ones in order', () => {
    assert.deepEqual([...NOTIFICATION_CHANNELS], ['email', 'telegram', 'whatsapp'])
    assert.deepEqual(enabledChannels(goodPrefs()), ['email', 'whatsapp'])
  })

  it('refuses delivery when unconfigured, muted, or transport-less', () => {
    assert.equal(shouldDeliver(null, { configured: true }), false)
    assert.equal(
      shouldDeliver(
        { ...goodPrefs(), email_enabled: false, whatsapp_enabled: false },
        { configured: true },
      ),
      false,
    )
    assert.equal(shouldDeliver(goodPrefs(), { configured: false }), false)
  })

  it('allows delivery only with channels on and transport configured', () => {
    assert.equal(shouldDeliver(goodPrefs(), { configured: true }), true)
  })
})

describe('digest windows', () => {
  it('pins the cadence vocab', () => {
    assert.deepEqual([...DIGEST_CADENCES], ['realtime', 'daily', 'weekly', 'monthly'])
    assert.equal(isDigestCadence('hourly'), false)
  })

  it('projects daily/realtime to today, weekly/monthly forward', () => {
    assert.deepEqual(digestWindow('daily', '2026-10-30'), {
      from: '2026-10-30',
      to: '2026-10-30',
    })
    assert.deepEqual(digestWindow('realtime', '2026-10-30'), {
      from: '2026-10-30',
      to: '2026-10-30',
    })
    assert.deepEqual(digestWindow('weekly', '2026-10-30'), {
      from: '2026-10-30',
      to: '2026-11-05',
    })
    assert.deepEqual(digestWindow('monthly', '2026-10-30'), {
      from: '2026-10-30',
      to: '2026-11-28',
    })
  })

  it('refuses a malformed date instead of projecting garbage', () => {
    assert.throws(() => digestWindow('daily', 'not-a-date'))
  })
})

describe('digest sections reuse the shared business rules', () => {
  const tasks = [
    {
      id: 'a',
      title: 'Late report',
      status: 'todo',
      due_date: '2000-01-01',
      priority: 'high',
    },
    {
      id: 'b',
      title: 'Done deed',
      status: 'done',
      due_date: '2000-01-01',
      priority: null,
    },
    {
      id: 'c',
      title: 'Today chore',
      status: 'todo',
      due_date: '2026-10-30',
      priority: null,
    },
  ]

  it('the owned overdue rule says what is late, not the digest', () => {
    assert.equal(isTaskOverdue({ due_date: '2000-01-01', status: 'todo' }), true)
    assert.equal(isTaskOverdue({ due_date: '2000-01-01', status: 'done' }), false)
    assert.equal(isTaskOverdue({ due_date: null, status: 'todo' }), false)
  })

  it('tasks count open/overdue/due-today through the injected owned rule', () => {
    const section = tasksDigestSection(tasks, '2026-10-30', isTaskOverdue)
    assert.equal(section.lines[0], '2 open · 1 overdue · 1 due today')
    assert.match(section.lines[1], /Late report/)
  })

  it('empty tasks read as nothing open, never as an error', () => {
    assert.deepEqual(tasksDigestSection([], '2026-10-30', isTaskOverdue).lines, [
      'Nothing open.',
    ])
  })

  it('the owned calendar merge orders and clips upcoming items', () => {
    const items = [
      {
        id: '1',
        item_type: 'event',
        title: 'Later',
        date: '2026-11-02',
        starts_at: null,
        branch: null,
        zone: null,
        href: null,
      },
      {
        id: '2',
        item_type: 'event',
        title: 'Sooner',
        date: '2026-10-31',
        starts_at: null,
        branch: null,
        zone: null,
        href: null,
      },
      {
        id: '3',
        item_type: 'event',
        title: 'Far',
        date: '2027-01-01',
        starts_at: null,
        branch: null,
        zone: null,
        href: null,
      },
    ]
    const merged = combineCalendarFeed(
      { event: items },
      { dateFrom: '2026-10-30', dateTo: '2026-11-05' },
    )
    assert.deepEqual(
      merged.map((item) => item.title),
      ['Sooner', 'Later'],
    )
    const section = upcomingDigestSection(
      'events',
      'Upcoming events',
      merged.map((item) => ({ title: item.title, date: item.date })),
    )
    assert.equal(section.lines.length, 2)
    assert.match(section.lines[0], /Sooner/)
  })

  it('upcoming sections format pre-ordered entries and cap the lines', () => {
    const entries = Array.from({ length: 12 }, (_, index) => ({
      title: `Item ${index}`,
      date: '2026-11-01',
    }))
    const section = upcomingDigestSection('celebrations', 'Celebrations', entries)
    assert.equal(section.lines.length, 8)
    assert.deepEqual(upcomingDigestSection('celebrations', 'Celebrations', []).lines, [
      'Nothing in this window.',
    ])
  })

  it('activity summarises by action and caps the lines', () => {
    const rows = Array.from({ length: 12 }, (_, index) => ({
      action: 'task updated',
      actor: 'admin-1',
      at: `2026-10-30T10:${String(index).padStart(2, '0')}:00Z`,
      detail: `task ${index}`,
    }))
    const section = activityDigestSection(rows)
    assert.equal(section.lines[0], '12 task updated')
    assert.equal(section.lines.length, 9)
  })

  it('empty activity reads as nothing recorded', () => {
    assert.deepEqual(activityDigestSection([]).lines, ['Nothing recorded.'])
  })
})

describe('digest content is channel-agnostic text', () => {
  it('builds a subject and a sectioned body', () => {
    const content = buildDigestContent({
      cadence: 'weekly',
      date: '2026-10-30',
      sections: [tasksDigestSection([], '2026-10-30', isTaskOverdue)],
    })
    assert.equal(content.subject, 'Admin digest · weekly · 2026-10-30')
    assert.match(content.body, /## Tasks \(1\)/)
    assert.match(content.body, /Nothing open\./)
  })

  it('says so when no sections are enabled', () => {
    const content = buildDigestContent({
      cadence: 'daily',
      date: '2026-10-30',
      sections: [],
    })
    assert.match(content.body, /No sections enabled\./)
  })
})

describe('phase-1 wiring reuses collectors and carries no transport', () => {
  it('the shared module stays dependency-free (reuse arrives injected)', () => {
    const src = codeOf(SHARED)
    assert.doesNotMatch(src, /from '\.\//, 'no relative imports: nothing to drift from')
    assert.doesNotMatch(src, /^import /m, 'no imports at all (message-tokens precedent)')
  })

  it('the server util calls the owned rules instead of copying them', () => {
    const src = codeOf(SERVER)
    assert.match(src, /isTaskOverdue/, 'overdue stays the one shared predicate')
    assert.match(
      src,
      /combineCalendarFeed/,
      'ordering/clipping stays the one shared merge',
    )
    assert.match(
      src,
      /celebrationsToCalendarItems/,
      'celebrations reuse the calendar projection',
    )
  })

  it('the server util reads the register through the existing collectors', () => {
    const src = codeOf(SERVER)
    assert.match(src, /notification_preferences/, 'prefs come from the 0061 register')
    assert.match(src, /collectCelebrations/, 'celebrations reuse the feed collector')
    assert.match(src, /celebrationsRollup/, 'celebrations reuse the roll-up')
    assert.match(src, /officeBranchScope/, 'tasks reuse the tasks-list scope predicate')
    assert.match(src, /tryListDomain/, 'absent domains degrade per-domain, never fork')
  })

  it('the server builder fails closed on unconfigured or muted admins', () => {
    const src = codeOf(SERVER)
    assert.match(src, /if \(!prefs\) return null/, 'no row means no digest')
    assert.match(src, /channels\.length === 0/, 'no channel means no digest')
  })

  it('no transport, no provider, no secret anywhere near phase 1', () => {
    for (const file of [SHARED, SERVER]) {
      const src = codeOf(file)
      assert.doesNotMatch(src, /smtp/i, `${file} names no mail transport`)
      assert.doesNotMatch(src, /api\.telegram\.org/, `${file} calls no Telegram API`)
      assert.doesNotMatch(src, /twilio/i, `${file} names no SMS provider`)
      assert.doesNotMatch(
        src,
        /WHATSAPP_TOKEN|TELEGRAM_TOKEN|SMTP_/i,
        `${file} reads no secret`,
      )
      assert.doesNotMatch(src, /fetch\(/, `${file} makes no network call`)
    }
  })

  it('the register confines cadence, sections and dedup at the database', () => {
    const src = read(MIGRATION)
    assert.match(src, /cadence IN \('realtime', 'daily', 'weekly', 'monthly'\)/)
    assert.match(src, /ARRAY\['tasks', 'celebrations', 'events', 'activity'\]/)
    assert.match(src, /admin_user\s+uuid NOT NULL UNIQUE/)
    assert.match(src, /REVOKE ALL ON notification_preferences FROM PUBLIC/)
    assert.match(src, /GRANT SELECT ON notification_preferences TO directus_app/)
  })

  it('the down script refuses a non-empty register before it drops', () => {
    const src = read(DOWN)
    assert.match(src, /refusing to roll back notification preferences/)
    assert.match(src, /DROP TABLE IF EXISTS notification_preferences/)
  })
})
