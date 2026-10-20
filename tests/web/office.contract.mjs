/**
 * AFC-477 contract tests — office bundle: transfers, marriage, minutes,
 * tasks, announcements, calendar, search.
 *
 * Pure node:test, no dependencies. Asserts the structural contract the
 * office routes are built on:
 *   1. Schema: 0013 creates the seven §9 tables + five audit tables with
 *      the §9 column sets; events deltas are conditional; no DELETE grant.
 *   2. Shared: zod schemas, collections, matrix rows, feed helper.
 *   3. Scoping: list/detail routes resolve inside the caller scope
 *      (transfer from/to OR, announcement area-wide null, tasks mine=1,
 *      publish window for readers, search fail-closed).
 *   4. Audit: every create/status move writes its *_events row.
 *   5. Calendar/search: one shared combiner; scope-logged reads.
 *
 * Run: node --test tests/web/office.contract.mjs
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

const MIGRATION = 'services/directus/schema/migrations/20261020_0013_office.sql'
const DOWN = 'services/directus/schema/migrations/rollback/20261020_0013_office.down.sql'
const ROUTES = {
  transfersList: 'apps/web/server/api/transfers/index.get.ts',
  transfersCreate: 'apps/web/server/api/transfers/index.post.ts',
  transfersDetail: 'apps/web/server/api/transfers/[id].get.ts',
  transfersPatch: 'apps/web/server/api/transfers/[id].patch.ts',
  transfersCsv: 'apps/web/server/api/transfers/export.csv.get.ts',
  marriageList: 'apps/web/server/api/marriage/index.get.ts',
  marriageCreate: 'apps/web/server/api/marriage/index.post.ts',
  marriageDetail: 'apps/web/server/api/marriage/[id].get.ts',
  minutesList: 'apps/web/server/api/minutes/index.get.ts',
  minutesCreate: 'apps/web/server/api/minutes/index.post.ts',
  minutesDetail: 'apps/web/server/api/minutes/[id].get.ts',
  tasksList: 'apps/web/server/api/tasks/index.get.ts',
  tasksCreate: 'apps/web/server/api/tasks/index.post.ts',
  tasksDetail: 'apps/web/server/api/tasks/[id].get.ts',
  tasksPatch: 'apps/web/server/api/tasks/[id].patch.ts',
  tasksCsv: 'apps/web/server/api/tasks/export.csv.get.ts',
  announcementsList: 'apps/web/server/api/announcements/index.get.ts',
  announcementsCreate: 'apps/web/server/api/announcements/index.post.ts',
  announcementsDetail: 'apps/web/server/api/announcements/[id].get.ts',
  announcementsPatch: 'apps/web/server/api/announcements/[id].patch.ts',
  referralsList: 'apps/web/server/api/referrals/index.get.ts',
  referralsCreate: 'apps/web/server/api/referrals/index.post.ts',
  calendar: 'apps/web/server/api/calendar/index.get.ts',
  search: 'apps/web/server/api/search/index.get.ts',
  officeUtil: 'apps/web/server/utils/office.ts',
}
const SHARED = {
  schema: 'packages/shared/src/schemas/office.ts',
  barrel: 'packages/shared/src/schemas/index.ts',
  collections: 'packages/shared/src/collections.ts',
  matrix: 'packages/shared/src/role-matrix.ts',
  feed: 'packages/shared/src/office-feed.ts',
}
const PAGES = {
  transfers: 'apps/web/pages/transfers/index.vue',
  transferDetail: 'apps/web/pages/transfers/[id].vue',
  marriage: 'apps/web/pages/marriage/index.vue',
  minutes: 'apps/web/pages/minutes/index.vue',
  tasks: 'apps/web/pages/tasks/index.vue',
  taskDetail: 'apps/web/pages/tasks/[id].vue',
  announcements: 'apps/web/pages/announcements/index.vue',
  calendar: 'apps/web/pages/calendar/index.vue',
  search: 'apps/web/pages/search/index.vue',
}

describe('office — schema (§9)', () => {
  it('the migration creates the seven §9 tables', () => {
    const src = sqlOf(MIGRATION)
    for (const table of [
      'transfers',
      'marriage_matters',
      'office_minutes',
      'minutes_attendees',
      'tasks',
      'announcements',
      'event_referrals',
    ]) {
      assert.match(
        src,
        new RegExp(`CREATE TABLE IF NOT EXISTS ${table}\\b`),
        `missing ${table}`,
      )
    }
  })

  it('the migration creates five per-domain audit tables', () => {
    const src = sqlOf(MIGRATION)
    for (const table of [
      'transfer_events',
      'marriage_matter_events',
      'office_minute_events',
      'task_events',
      'announcement_events',
    ]) {
      assert.match(
        src,
        new RegExp(`CREATE TABLE IF NOT EXISTS ${table}\\b`),
        `missing ${table}`,
      )
    }
  })

  it('the migration documents the event_sessions deferral instead of forking events', () => {
    const src = read(MIGRATION)
    assert.match(src, /event_sessions/i, 'names event_sessions')
    assert.match(src, /DEFERRED/i, 'states the defer choice')
    assert.doesNotMatch(
      sqlOf(MIGRATION),
      /CREATE TABLE IF NOT EXISTS event_sessions/,
      'does not create event_sessions',
    )
  })

  it('the events §9.6 deltas are conditional alters, never a created table', () => {
    const src = sqlOf(MIGRATION)
    assert.match(src, /overview/, 'names overview')
    assert.match(src, /invite_a_friend_enabled/, 'names invite_a_friend_enabled')
    assert.match(src, /attendance_session/, 'names attendance_session')
    assert.doesNotMatch(src, /CREATE TABLE IF NOT EXISTS events/, 'never creates events')
  })

  it('the app has no DELETE on any office table', () => {
    const src = sqlOf(MIGRATION)
    assert.doesNotMatch(src, /GRANT DELETE/, 'no DELETE grant')
    assert.doesNotMatch(src, /GRANT ALL/, 'no blanket grant')
    assert.match(
      src,
      /REVOKE ALL ON transfers FROM PUBLIC/,
      'revokes public on transfers',
    )
  })

  it('the down script refuses while rows exist and leaves events deltas alone', () => {
    const src = read(DOWN)
    assert.match(src, /restrict_violation/, 'refuses with restrict_violation')
    assert.match(
      src,
      /are NOT dropped|never touched|leaves/i,
      'leaves surviving events columns alone',
    )
    assert.doesNotMatch(
      codeOf(DOWN),
      /DROP COLUMN/,
      'no column drop on a surviving table',
    )
  })
})

describe('office — shared contracts', () => {
  it('the zod schemas cover all five domains plus referrals/calendar/search', () => {
    const src = codeOf(SHARED.schema)
    for (const name of [
      'transferFormSchema',
      'marriageFormSchema',
      'minutesFormSchema',
      'taskFormSchema',
      'announcementFormSchema',
      'referralFormSchema',
      'calendarQuerySchema',
      'searchQuerySchema',
    ]) {
      assert.match(src, new RegExp(name), `missing ${name}`)
    }
  })

  it('the collections register the office tables', () => {
    const src = codeOf(SHARED.collections)
    for (const name of [
      'transfers',
      'marriageMatters',
      'officeMinutes',
      'minutesAttendees',
      'tasks',
      'announcements',
      'eventReferrals',
    ]) {
      assert.match(src, new RegExp(name), `missing ${name}`)
    }
  })

  it('the role matrix carries the §11 office rows', () => {
    const src = codeOf(SHARED.matrix)
    for (const name of [
      'transfers',
      'marriageMatters',
      'officeMinutes',
      'tasks',
      'announcements',
      'eventReferrals',
    ]) {
      assert.match(src, new RegExp(`COLLECTIONS\\.${name}`), `missing matrix row ${name}`)
    }
  })

  it('the feed helper owns the single combination (no second helper)', () => {
    const src = codeOf(SHARED.feed)
    assert.match(src, /combineCalendarFeed/, 'exports combineCalendarFeed')
    assert.match(src, /describeScope/, 'exports describeScope')
  })

  it('tasks description is a restricted read', () => {
    const src = codeOf(SHARED.matrix)
    assert.match(src, /\[COLLECTIONS\.tasks\]/, 'tasks field restriction present')
    assert.match(src, /description/, 'description restricted')
  })
})

describe('office — routes', () => {
  it('transfers scope by from_branch OR to_branch and audit approval', () => {
    assert.match(codeOf(ROUTES.transfersList), /transferScope/, 'list uses transferScope')
    assert.match(codeOf(ROUTES.transfersPatch), /approved/, 'patch names approval')
    assert.match(
      codeOf(ROUTES.transfersPatch),
      /transfer_events/,
      'patch writes the audit row',
    )
  })

  it('tasks support assignee-scoped views and overdue is derived, not stored', () => {
    assert.match(codeOf(ROUTES.tasksList), /mine/, 'list supports mine=1')
    assert.match(
      codeOf(SHARED.feed),
      /isTaskOverdue/,
      'overdue is a helper, not a column',
    )
    assert.doesNotMatch(
      sqlOf(MIGRATION),
      /^\s*overdue\s/m,
      'no overdue column in the migration',
    )
  })

  it('announcements enforce the publish window for readers', () => {
    assert.match(
      codeOf(ROUTES.announcementsList),
      /published/,
      'list narrows to published for readers',
    )
    assert.match(codeOf(ROUTES.announcementsPatch), /approved/, 'publish stamps approval')
  })

  it('minutes attach attendees and stay matrix-gated', () => {
    assert.match(
      codeOf(ROUTES.minutesDetail),
      /minutes_attendees/,
      'detail carries attendees',
    )
    assert.match(
      codeOf('apps/web/server/api/minutes/[id].attendees.post.ts'),
      /attendee/,
      'attendee route exists',
    )
  })

  it('calendar combines services+events+celebrations via the shared helper', () => {
    const src = codeOf(ROUTES.calendar)
    assert.match(src, /combineCalendarFeed/, 'uses the shared combiner')
    assert.match(src, /celebrations/, 'reads celebrations where present')
    assert.match(src, /sunday_services/, 'reads services')
  })

  it('search is scoped and fail-closed with scope logging', () => {
    const src = codeOf(ROUTES.search)
    assert.match(src, /getPortalScope/, 'scope resolves before any domain is read')
    assert.match(src, /logScopedQuery/, 'search reads are scope-logged')
  })

  it('exports reuse the list query (no drift)', () => {
    assert.match(
      codeOf(ROUTES.transfersCsv),
      /transferScope/,
      'transfer CSV reuses the scope',
    )
    assert.match(
      codeOf(ROUTES.tasksCsv),
      /officeBranchScope/,
      'task CSV reuses the scope',
    )
  })
})

describe('office — pages', () => {
  it('each domain has a list page and details link to their audit', () => {
    for (const [name, rel] of Object.entries(PAGES)) {
      assert.doesNotThrow(() => read(rel), `${name} page exists (${rel})`)
    }
    assert.match(
      codeOf(PAGES.transferDetail),
      /Audit trail/,
      'transfer detail shows the trail',
    )
    assert.match(codeOf(PAGES.taskDetail), /Audit trail/, 'task detail shows the trail')
  })

  it('calendar filters by type and links to details', () => {
    assert.match(codeOf(PAGES.calendar), /item_type/, 'calendar filters by type')
    assert.match(codeOf(PAGES.calendar), /href/, 'calendar links to detail (US-U3 AC2)')
  })
})
