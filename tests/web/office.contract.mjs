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
import { readdirSync, readFileSync } from 'node:fs'
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
      codeOf('apps/web/server/api/minutes/[id]/attendees.post.ts'),
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

describe('office — minutes attendee attach (AFC-701 verdict B, AFC-702 F1–F4)', () => {
  const ATTACH = 'apps/web/server/api/minutes/[id]/attendees.post.ts'

  it('update holders keep the existing path; no minutes_attendees grant is consulted', () => {
    const src = codeOf(ATTACH)
    assert.match(
      src,
      /can\(scope, 'office_minutes', 'update'\)/,
      'update fast path present',
    )
    assert.match(
      src,
      /requireCan\(scope, 'office_minutes', 'update'\)/,
      'existing 403 shape reused',
    )
    assert.doesNotMatch(
      src,
      /can\(scope, 'minutes_attendees'/,
      'no minutes_attendees capability check',
    )
    assert.doesNotMatch(
      src,
      /requireCan\(scope, 'minutes_attendees'/,
      'no minutes_attendees gate',
    )
  })

  it('exception opens only for create + own scoped row + authorship + draft, else 403', () => {
    const src = codeOf(ATTACH)
    assert.match(src, /can\(scope, 'office_minutes', 'create'\)/, 'create check present')
    assert.match(src, /scopeFilter\(scope\)/, 'same-branch scoped load unchanged')
    assert.match(src, /created_by/, 'authorship is read from the row')
    assert.match(
      src,
      /createdBy === scope\.session\.user\.id/,
      'strict author match, NULL never passes',
    )
    assert.match(
      src,
      /row\.status !== 'draft'/,
      'exact-draft match denies final/published',
    )
  })

  it('positive shape: a create-only author reaching createItem has passed all three gates', () => {
    const src = codeOf(ATTACH)
    const createGate = src.indexOf("can(scope, 'office_minutes', 'create')")
    const authorGate = src.indexOf('createdBy === scope.session.user.id')
    const draftGate = src.indexOf("row.status !== 'draft'")
    const write = src.indexOf("'minutes_attendees',")
    assert.ok(
      createGate !== -1 && authorGate !== -1 && draftGate !== -1,
      'all gates present',
    )
    assert.ok(
      createGate < write && authorGate < write && draftGate < write,
      'all gates precede the minutes_attendees write',
    )
  })

  it('negative shapes stay denied: other author, out-of-scope branch, non-draft, neither capability', () => {
    const src = codeOf(ATTACH)
    // Other author: strict author match fails -> falls through to requireCan(update) 403.
    assert.match(src, /isAuthor/, 'other-author denial path present')
    // Out-of-scope branch: scoped load 404s before any gate passes.
    assert.match(
      src,
      /findScopedItem[\s\S]*office_minutes[\s\S]*scopeFilter\(scope\)/,
      'scoped load 404s out-of-scope branches',
    )
    // Non-draft: exact-draft check denies -> requireCan(update) 403.
    assert.match(src, /status.*draft/, 'non-draft denial path present')
    // Neither create nor update: requireCan(update) throws the existing 403.
    assert.match(
      src,
      /if \(!can\(scope, 'office_minutes', 'create'\)\)/,
      'no-create no-update callers denied',
    )
  })

  it('F4: uuid boundary guard and explicit fail-closed row fields', () => {
    const src = codeOf(ATTACH)
    assert.match(src, /assertUuidParam/, ':id validated before any store read')
    assert.match(src, /invalid_minutes_id/, 'named invalid-id code')
    assert.match(src, /'created_by', 'status'/, 'explicit row fields requested')
  })

  it('F2: attached person resolves in-scope and attendee_user existence is verified', () => {
    const src = codeOf(ATTACH)
    assert.match(
      src,
      /findScopedItem\(event, scope, 'people', parsed\.data\.person/,
      'person resolves inside caller scope (404 otherwise)',
    )
    assert.match(
      src,
      /isUuid\(parsed\.data\.person\)/,
      'malformed person id is 400, never SQL',
    )
    assert.match(
      src,
      /isUuid\(parsed\.data\.attendee_user\)/,
      'malformed attendee_user id is 400, never SQL',
    )
    assert.match(src, /\/users\//, 'attendee_user existence is read, not trusted')
    assert.match(
      src,
      /attendee_user_unverifiable/,
      'unreadable user registry fails closed (503), never allows',
    )
  })

  it('F3: every successful attach writes an audit row with a storable event type', () => {
    const src = codeOf(ATTACH)
    assert.match(src, /writeOfficeAudit/, 'audit helper used')
    assert.match(src, /office_minute_events/, 'audit lands in the minute trail')
    assert.match(src, /event_type: 'note'/, 'uses a CHECK-allowed event type')
    assert.doesNotMatch(src, /attendee_added/, 'never writes the non-storable type')
    const write = src.indexOf("'minutes_attendees',")
    const audit = src.indexOf("writeOfficeAudit(event, scope, 'office_minute_events'")
    assert.ok(write !== -1 && audit !== -1, 'write and audit calls present')
    assert.ok(audit > write, 'audit follows the successful write')
  })

  it('F1: role matrix untouched — minutesAttendees grants no create path', () => {
    const route = codeOf(ATTACH)
    assert.doesNotMatch(route, /minutes_attendees.*create/, 'route adds no grant path')
    const matrix = codeOf(SHARED.matrix)
    assert.match(matrix, /\[COLLECTIONS\.minutesAttendees\]/, 'matrix row still present')
    assert.doesNotMatch(
      matrix,
      /\[COLLECTIONS\.minutesAttendees\][\s\S]{0,400}branch_admin: \[ALL/,
      'branch roles gain no write grant',
    )
  })

  it('attendee body validation and createItem payload are unchanged', () => {
    const src = codeOf(ATTACH)
    assert.match(src, /attendeeFormSchema\.safeParse/, 'zod validation kept')
    assert.match(src, /throwValidation\(parsed\.error\)/, 'validation error shape kept')
    assert.match(src, /minute: id,/, 'minute linkage kept')
    assert.match(src, /person: parsed\.data\.person \?\? null,/, 'person payload kept')
    assert.match(
      src,
      /attendee_user: parsed\.data\.attendee_user \?\? null,/,
      'attendee_user payload kept',
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

/* ---------------------------------------------------------------------------
 * AFC-670 — minutes create: times/location, Markdown editor with samples.
 * ------------------------------------------------------------------------- */
const MINUTES_670 = {
  migration: 'services/directus/schema/migrations/20261020_0033_office_minutes_times.sql',
  down: 'services/directus/schema/migrations/rollback/20261020_0033_office_minutes_times.down.sql',
  dbSuite: 'tests/db/95_office_minutes_times.sql',
  markdown: 'packages/shared/src/markdown.ts',
  samples: 'packages/shared/src/minutes-samples.ts',
  createPage: 'apps/web/pages/minutes/new.vue',
  detailPage: 'apps/web/pages/minutes/[id].vue',
  attendeeRoute: 'apps/web/server/api/minutes/[id]/attendees.post.ts',
  storeMapper: 'apps/web/server/utils/directus.ts',
}

describe('minutes create — DDL (AFC-670 §A)', () => {
  it('the 0033 migration adds times/location idempotently with the order CHECK', () => {
    const src = sqlOf(MINUTES_670.migration)
    assert.match(src, /ADD COLUMN IF NOT EXISTS start_time/, 'adds start_time')
    assert.match(src, /ADD COLUMN IF NOT EXISTS end_time/, 'adds end_time')
    assert.match(src, /ADD COLUMN IF NOT EXISTS location/, 'adds location')
    assert.match(src, /office_minutes_time_order/, 'names the order CHECK')
    assert.match(src, /end_time > start_time/, 'the CHECK orders end after start')
  })

  it('the 0033 migration extends the app column grants and nothing else', () => {
    const src = sqlOf(MINUTES_670.migration)
    assert.match(
      src,
      /GRANT INSERT \(id, title, meeting_date, body, file, status, branch, zone, created_by, created_at, updated_at, start_time, end_time, location\)/,
      'insert list extended',
    )
    assert.match(
      src,
      /GRANT UPDATE \(start_time, end_time, location\)/,
      'update list extended',
    )
    assert.match(src, /REVOKE ALL ON office_minutes FROM PUBLIC/, 'public still revoked')
    assert.doesNotMatch(src, /GRANT DELETE/, 'no DELETE grant')
    assert.doesNotMatch(src, /CREATE ROLE/i, 'no role minted (ADR-0002)')
  })

  it('the down script drops exactly what 0033 added and keeps the rows', () => {
    const src = read(MINUTES_670.down)
    assert.match(
      src,
      /DROP CONSTRAINT IF EXISTS office_minutes_time_order/,
      'drops the CHECK',
    )
    assert.match(src, /DROP COLUMN IF EXISTS start_time/, 'drops start_time')
    assert.match(src, /DROP COLUMN IF EXISTS end_time/, 'drops end_time')
    assert.match(src, /DROP COLUMN IF EXISTS location/, 'drops location')
    assert.match(src, /REVOKE ALL ON office_minutes FROM PUBLIC/, 're-asserts the seal')
    assert.doesNotMatch(codeOf(MINUTES_670.down), /DROP TABLE/, 'never drops the table')
  })

  it('the db suite covers columns, CHECK, rerun, guards and rollback', () => {
    const src = read(MINUTES_670.dbSuite)
    for (const name of ['columns', 'order', 'rerun', 'guards', 'rollback']) {
      assert.match(src, new RegExp(`95\\.[0-9]\\s+${name}`, 'i'), `covers ${name}`)
    }
    assert.match(src, /23514/, 'pins the CHECK violation code')
    assert.match(src, /42501/, 'pins the no-DELETE ceiling')
  })
})

describe('minutes create — shared contracts (AFC-670 §B)', () => {
  it('minutesFormSchema carries times, location and the order refine', () => {
    const src = codeOf(SHARED.schema)
    assert.match(src, /start_time: timeSchema/, 'validates start_time')
    assert.match(src, /end_time: timeSchema/, 'validates end_time')
    assert.match(src, /location: optionalText\(255\)/, 'validates location')
    assert.match(src, /end_time > v\.start_time/, 'refines end after start')
    assert.match(src, /path: \['end_time'\]/, 'the refine reports on end_time')
    assert.match(src, /branch: branchRef/, 'branch stays required + scoped')
  })

  it('timeSchema is a zero-padded 24-hour HH:MM', () => {
    const src = codeOf('packages/shared/src/schemas/common.ts')
    assert.match(src, /timeSchema/, 'timeSchema lives with the primitives')
    assert.match(src, /\(\[01\]\\d\|2\[0-3\]\)/, 'hour range pinned')
    assert.match(src, /\[0-5\]\\d/, 'minute range pinned')
  })

  it('the OfficeMinute interface carries the new columns', () => {
    const src = codeOf(SHARED.schema)
    assert.match(src, /start_time: string \| null/, 'types start_time')
    assert.match(src, /end_time: string \| null/, 'types end_time')
    assert.match(src, /location: string \| null/, 'types location')
  })

  it('attendeeFormSchema still requires at least one side', () => {
    const src = codeOf(SHARED.schema)
    assert.match(src, /attendeeFormSchema/, 'attendee schema present')
    assert.match(src, /Link a person or a user/, 'presence message kept')
  })

  it('the safe Markdown renderer escapes first and allowlists its tags', () => {
    const src = codeOf(MINUTES_670.markdown)
    assert.match(src, /escapeHtml/, 'exports the escaper')
    assert.match(src, /renderMarkdownSafe/, 'exports the renderer')
    const escapeAt = src.indexOf('function escapeHtml')
    const renderAt = src.indexOf('function renderMarkdownSafe')
    assert.ok(escapeAt !== -1 && renderAt !== -1, 'both functions defined')
    assert.match(src, /&lt;/, 'escapes angle brackets')
    assert.match(src, /LINK_SCHEME/, 'link targets are validated against one scheme list')
    assert.match(src, /https\?:/, 'links allow http(s)')
    assert.match(src, /mailto:/, 'links allow mailto')
    assert.doesNotMatch(src, /javascript:/, 'no script scheme anywhere')
    for (const tag of [
      '<strong>',
      '<em>',
      '<u>',
      '<del>',
      '<blockquote>',
      '<table>',
      '<pre><code>',
    ]) {
      assert.ok(src.includes(tag), `renderer emits ${tag}`)
    }
  })

  it('two samples ship as editor content, never as rows', () => {
    const src = codeOf(MINUTES_670.samples)
    assert.match(src, /council-meeting/, 'council meeting sample')
    assert.match(src, /welfare-visit/, 'welfare visit sample')
    assert.match(src, /MINUTES_SAMPLES/, 'exports the sample list')
    assert.doesNotMatch(src, /INSERT INTO/i, 'no database rows in the samples module')
  })
})

describe('minutes create — routes (AFC-670 §C)', () => {
  it('POST persists the new fields through the scoped create', () => {
    const src = codeOf(ROUTES.minutesCreate)
    assert.match(src, /start_time: form\.start_time/, 'writes start_time')
    assert.match(src, /end_time: form\.end_time/, 'writes end_time')
    assert.match(src, /location: form\.location/, 'writes location')
    assert.match(src, /minutesFormSchema/, 'still validates the form first')
    assert.match(
      src,
      /requireCan\(scope, 'office_minutes', 'create'\)/,
      'create stays matrix-gated',
    )
    assert.match(src, /resolveBranch/, 'branch still resolves in scope')
  })

  it('list and detail project no field whitelist that could drop the columns', () => {
    assert.doesNotMatch(
      codeOf(ROUTES.minutesList),
      /fields:/,
      'list has no field projection',
    )
    assert.doesNotMatch(
      codeOf(ROUTES.minutesDetail),
      /fields:/,
      'detail has no field projection',
    )
    assert.match(
      codeOf(ROUTES.minutesDetail),
      /minutes_attendees/,
      'detail still carries attendees',
    )
  })

  it('failure shape stays {code, fields}: 400 validates, 403 names, never a bare 500', () => {
    for (const rel of [
      ROUTES.minutesCreate,
      ROUTES.minutesDetail,
      MINUTES_670.attendeeRoute,
    ]) {
      assert.match(codeOf(rel), /requireCan/, `${rel} gates on the matrix (named 403)`)
      assert.doesNotMatch(codeOf(rel), /statusCode:\s*500/, `${rel} contains no bare 500`)
    }
    assert.match(
      codeOf(ROUTES.minutesCreate),
      /throwValidation/,
      'create 400s carry fields',
    )
    assert.match(
      codeOf(MINUTES_670.attendeeRoute),
      /throwValidation/,
      'attendee 400s carry fields',
    )
  })

  it('the central store mapper strips 5xx detail instead of leaking SQL', () => {
    const src = codeOf(MINUTES_670.storeMapper)
    assert.match(src, /mapDirectusError/, 'single mapper owns store failures')
    assert.match(
      read(MINUTES_670.storeMapper),
      /Never copy upstream/,
      'states the no-leak rule',
    )
  })
})

describe('minutes create — pages (AFC-670 §D)', () => {
  it('the create page carries every field plus a staged attendee list', () => {
    const src = codeOf(MINUTES_670.createPage)
    for (const name of [
      'form.title',
      'form.meeting_date',
      'form.start_time',
      'form.end_time',
      'form.location',
      'form.branch',
      'form.body',
    ]) {
      assert.ok(src.includes(name), `create page binds ${name}`)
    }
    assert.match(src, /stagedAttendees/, 'attendees stage client-side before save')
    assert.match(
      src,
      /\/api\/minutes\/\$\{id\}\/attendees/,
      'staged attendees attach after create',
    )
  })

  it('branch and attendee pickers are searchable EntitySelects, never manual IDs', () => {
    const src = codeOf(MINUTES_670.createPage)
    assert.match(src, /EntitySelect/, 'uses EntitySelect')
    assert.match(src, /useBranchOptions/, 'branches come from the scoped list')
    assert.match(src, /usePersonSearch/, 'people come from the scoped directory search')
    assert.match(src, /server-search/, 'person picker searches server-side')
    assert.doesNotMatch(
      src,
      /attendee_user/,
      'no staff-user UUID textbox without a directory endpoint',
    )
    assert.doesNotMatch(src, /assignee_user/, 'no manual user-id field of any kind')
  })

  it('the editor toolbar covers the whole renderer set with a preview', () => {
    const src = codeOf(MINUTES_670.createPage)
    for (const mark of [
      "'**', '**'",
      "'*', '*'",
      "'++', '++'",
      "'~~', '~~'",
      "'# '",
      "'## '",
      "'### '",
      "'- '",
      "'1. '",
      "'> '",
      "'`', '`'",
    ]) {
      assert.ok(src.includes(mark), `toolbar inserts ${mark}`)
    }
    assert.match(src, /insertTable/, 'toolbar inserts tables')
    assert.match(src, /insertLink/, 'toolbar inserts links')
    assert.match(src, /showPreview/, 'preview toggle exists')
    assert.match(
      src,
      /renderMarkdownSafe\(form\.value\.body\)/,
      'preview renders through the safe renderer',
    )
  })

  it('samples load from the shared module, one tap each', () => {
    const src = codeOf(MINUTES_670.createPage)
    assert.match(src, /MINUTES_SAMPLES/, 'imports the shared samples')
    assert.match(src, /loadSample/, 'sample loader present')
  })

  it('detail renders the body styled and safely, with times and location', () => {
    const src = codeOf(MINUTES_670.detailPage)
    assert.match(src, /renderMarkdownSafe/, 'detail uses the safe renderer')
    assert.match(src, /v-html="bodyHtml"/, 'styled output binds the rendered HTML')
    assert.match(
      src,
      /data\.value\?\.data\?\.body \?\? ''/,
      'missing body renders empty, never crashes',
    )
    assert.match(src, /timeRange/, 'detail shows the time range')
    assert.match(src, /data\.data\.location/, 'detail shows the location')
  })

  it('the list shows date, time and location with a scoped New entry point', () => {
    const src = codeOf(PAGES.minutes)
    assert.match(src, /timeRange/, 'list shows the time range')
    assert.match(src, /row\.location/, 'list shows the location snippet')
    assert.match(src, /to="\/minutes\/new"/, 'list links the create page')
    assert.match(src, /PermissionGate/, 'create entry stays permission-gated')
  })
})

/* ---------------------------------------------------------------------------
 * AFC-723 — dot-path routes are dead: slash-path registration.
 * Nitro file-based routing treats dots as literal segments, so
 * `minutes/[id].attendees.post.ts` registered `/api/minutes/:id.attendees`
 * while every caller POSTs to `/api/minutes/:id/attendees` (slash) — a 404.
 * Pin the fix: the directory route exists, no dot-path files remain in the
 * minutes API dir, and both callers hit the slash path.
 * ------------------------------------------------------------------------- */
const listFilesRecursive = (dir) =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? listFilesRecursive(path.join(dir, entry.name)) : [entry.name],
  )
const DOT_PATH_ROUTE = /^\[[^\]]+\]\.[^/]+\.(get|post|patch|put|delete)\.ts$/

describe('minutes attendees — slash-path registration (AFC-723)', () => {
  it('registers POST /api/minutes/:id/attendees as a directory route', () => {
    assert.doesNotThrow(
      () => read('apps/web/server/api/minutes/[id]/attendees.post.ts'),
      'minutes/[id]/attendees.post.ts exists',
    )
  })

  it('leaves no dot-path route files behind in the minutes API dir', () => {
    const dots = listFilesRecursive(
      path.join(root, 'apps/web/server/api/minutes'),
    ).filter((name) => DOT_PATH_ROUTE.test(name))
    assert.deepEqual(dots, [], `dot-path route files must not exist: ${dots.join(', ')}`)
  })

  it('both callers POST to the slash path, never the dotted one', () => {
    for (const page of [MINUTES_670.createPage, MINUTES_670.detailPage]) {
      assert.match(
        codeOf(page),
        /\/api\/minutes\/\$\{id\}\/attendees/,
        `${page} posts to /api/minutes/:id/attendees`,
      )
      assert.doesNotMatch(
        codeOf(page),
        /\$\{id\}\.attendees/,
        `${page} never uses the dotted path`,
      )
    }
  })
})
describe('office — F1 policy mirror parity (AFC-704, ADR-0012)', () => {
  const POLICY_UTIL = 'apps/web/server/utils/minutes-policy.ts'
  const GRANT_ROUTE = 'apps/web/server/api/admin/roles/[id]/permissions.post.ts'
  const MIRROR_MIGRATION =
    'services/directus/schema/migrations/20261020_0033_minutes_attendee_policy_mirror.sql'
  const MIRROR_DOWN =
    'services/directus/schema/migrations/rollback/20261020_0033_minutes_attendee_policy_mirror.down.sql'
  const ATTACH = 'apps/web/server/api/minutes/[id]/attendees.post.ts'

  it('the canonical filter carries the same three conditions as the portal rule', () => {
    const src = codeOf(POLICY_UTIL)
    assert.match(src, /MINUTES_ATTENDEE_CREATE_FILTER/, 'canonical filter exported')
    assert.match(src, /branch/, 'condition 1: branch scope present')
    assert.match(
      src,
      /\$CURRENT_USER\.branch_ids/,
      'condition 1: branch scope reads the caller branches',
    )
    assert.match(src, /minute_status/, 'condition 2: draft status present')
    assert.match(src, /'draft'/, 'condition 2: exact draft match')
    assert.match(src, /minute_created_by/, 'condition 3: authorship present')
    assert.match(src, /\$CURRENT_USER/, 'condition 3: authorship reads the caller id')
  })

  it('parity, portal-allow implies policy-allow: every portal gate has a filter twin', () => {
    const route = codeOf(ATTACH)
    const policy = codeOf(POLICY_UTIL)
    // Portal gate 1: scoped row load (branch). Filter twin: branch _in caller branches.
    assert.match(route, /scopeFilter\(scope\)/, 'portal loads the scoped row')
    assert.match(policy, /branch/, 'policy filters the same branch scope')
    // Portal gate 2: strict author match. Filter twin: minute_created_by _eq caller.
    assert.match(
      route,
      /createdBy === scope\.session\.user\.id/,
      'portal demands the strict author match',
    )
    assert.match(policy, /minute_created_by/, 'policy demands the same authorship')
    // Portal gate 3: exact draft. Filter twin: minute_status _eq draft.
    assert.match(route, /row\.status !== 'draft'/, 'portal demands exact draft')
    assert.match(policy, /minute_status/, 'policy demands the same draft')
  })

  it('parity, policy-allow implies portal-allow: the filter grants nothing the portal denies', () => {
    const policy = codeOf(POLICY_UTIL)
    // Pure conjunction: no _or branch that could admit a row the portal denies.
    assert.match(policy, /_and/, 'filter is a conjunction')
    assert.doesNotMatch(policy, /_or/, 'filter has no alternative allow path')
    // Exactly the three conditions: branch, draft, authorship -- no extra
    // permissive clause (e.g. no status wildcard, no public fallback).
    const andBlock = policy.slice(policy.indexOf('_and'))
    assert.match(andBlock, /branch/, 'conjunction covers scope')
    assert.match(andBlock, /minute_status/, 'conjunction covers draft')
    assert.match(andBlock, /minute_created_by/, 'conjunction covers authorship')
    assert.doesNotMatch(andBlock, /published|final|null/, 'no bypass value')
    // Portal side denies everything else with the existing 403 shape.
    const route = codeOf(ATTACH)
    assert.match(
      route,
      /requireCan\(scope, 'office_minutes', 'update'\)/,
      'portal denies the remainder with the update 403',
    )
  })

  it('the mirror migration installs the denorm the flat filter reads, with rollback', () => {
    const up = sqlOf(MIRROR_MIGRATION)
    assert.match(up, /ADD COLUMN IF NOT EXISTS minute_status/, 'status denorm added')
    assert.match(up, /ADD COLUMN IF NOT EXISTS minute_created_by/, 'author denorm added')
    assert.match(
      up,
      /afc_set_minute_attach_scope/,
      'write-time trigger maintains the denorm',
    )
    assert.match(up, /directus_migrator/, 'bootstrap-role guard present')
    assert.doesNotMatch(up, /CREATE ROLE/, 'no role provisioning (ADR-0002)')
    const down = read(MIRROR_DOWN)
    assert.match(
      down,
      /DROP TRIGGER IF EXISTS afc_set_minute_attach_scope/,
      'trigger dropped',
    )
    assert.match(
      down,
      /DROP FUNCTION IF EXISTS afc_set_minute_attach_scope/,
      'function dropped',
    )
    assert.match(down, /DROP COLUMN IF EXISTS minute_status/, 'status column dropped')
    assert.match(down, /DROP COLUMN IF EXISTS minute_created_by/, 'author column dropped')
  })

  it('the admin grant endpoint defaults the mirror filter for minutes_attendees:create', () => {
    const src = codeOf(GRANT_ROUTE)
    assert.match(src, /minutes-policy/, 'canonical filter imported (single source)')
    assert.match(
      src,
      /minutesAttendeeCreateFilter\(\)/,
      'minutes_attendees:create defaults to the mirror when no filter is supplied',
    )
    assert.match(
      src,
      /MINUTES_ATTENDEE_CREATE_COLLECTION/,
      'default is scoped to the minutes_attendees collection only',
    )
    assert.match(
      src,
      /MINUTES_ATTENDEE_CREATE_ACTION/,
      'default is scoped to the create action only',
    )
  })
})
