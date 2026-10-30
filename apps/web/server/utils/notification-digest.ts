import type { H3Event } from 'h3'
import {
  IMPERSONATION_AUDIT_COLLECTION,
  MAX_DIGEST_LINES,
  buildDigestContent,
  combineCalendarFeed,
  isTaskOverdue,
  upcomingDigestSection,
  digestWindow,
  enabledChannels,
  tasksDigestSection,
  activityDigestSection,
  validatePreferences,
  type CalendarItem,
  type DigestActivityRow,
  type DigestCadence,
  type DigestContent,
  type DigestSection,
  type DigestTaskRow,
  type NotificationChannel,
  type NotificationPreferences,
} from '@afc/shared'
import {
  collectCelebrations,
  celebrationsRollup,
  celebrationsToCalendarItems,
  type CelebrationFeedFilters,
  type CelebrationRow,
} from './celebration-feed'
import { logScopedQuery, officeBranchScope, tryListDomain } from './office'
import {
  eventScopeFilter,
  getPortalScope,
  listItems,
  mergeFilters,
  requireCan,
  type PortalScope,
} from './portal'

/**
 * Admin digest content builders (AFC-903 phase 1, chairman ask 2026-10-29).
 *
 * REUSE, NOT DUPLICATION. Every row below arrives through the same scoped
 * collector the matching surface already reads, and every shared business
 * rule is called — never copied — from the module that owns it:
 *   tasks        officeBranchScope — the same predicate as GET /api/tasks —
 *                classified with `isTaskOverdue` (owned by office-feed.ts:
 *                the task board's own rule), injected into the shared
 *                tasks section builder.
 *   celebrations collectCelebrations + celebrationsRollup — the same feed
 *                and roll-up the celebrations list, CSV export and calendar
 *                read — projected with celebrationsToCalendarItems (owned
 *                by celebration-feed.ts) and ordered/window-clipped with
 *                `combineCalendarFeed` (owned by office-feed.ts: the
 *                calendar's own merge).
 *   events       eventScopeFilter + the start_at window — the same upcoming
 *                predicate as GET /api/events — ordered/window-clipped
 *                with `combineCalendarFeed`.
 *   activity     tryListDomain over the office audit trails (task_events,
 *                announcement_events) plus the impersonation audit log —
 *                fail-soft per domain, so a missing collection contributes
 *                zero rows, never a forked table or a failed digest.
 *
 * CONTENT ONLY. Nothing here sends, schedules or retries: there are no
 * transport calls, no provider SDKs, no tokens and no secrets in this
 * file. A missing preference row means "unconfigured" and the builder
 * returns null — the phase-2 scheduler treats null as skip, never as
 * send-to-everyone. The `transportConfigured` gate stays `false` until
 * phase 3 providers are provisioned (board/CTO).
 */

const PREFS_COLLECTION = 'notification_preferences'

const PREFS_FIELDS = [
  'id',
  'admin_user',
  'email_enabled',
  'telegram_enabled',
  'whatsapp_enabled',
  'cadence',
  'sections',
]

const TASK_DIGEST_FIELDS = ['id', 'title', 'status', 'due_date', 'priority']

const EVENT_DIGEST_FIELDS = ['id', 'title', 'start_at', 'location', 'branch', 'zone']

export interface AdminDigest {
  channels: NotificationChannel[]
  cadence: DigestCadence
  content: DigestContent
}

function toTaskRow(row: Record<string, unknown>): DigestTaskRow {
  return {
    id: String(row.id ?? ''),
    title: typeof row.title === 'string' ? row.title : 'Untitled task',
    status: typeof row.status === 'string' ? row.status : 'todo',
    due_date: typeof row.due_date === 'string' ? row.due_date : null,
    priority: typeof row.priority === 'string' ? row.priority : null,
  }
}

/**
 * Preference lookup. Returns null when the admin never opted in
 * (unconfigured: the digest builder returns null and nothing is sent).
 * A refused read is NOT swallowed as "unconfigured": fail-closed means a
 * broken store skips loudly at the caller, not silently here — except the
 * caller here is the phase-2 scheduler, so until it exists this throw has
 * no live path and the null below covers only the genuinely-unset row.
 */
export async function getNotificationPreferences(
  event: H3Event,
  scope: PortalScope,
  adminUserId: string,
): Promise<NotificationPreferences | null> {
  const result = await listItems<Record<string, unknown>>(
    event,
    scope,
    PREFS_COLLECTION,
    {
      filter: { admin_user: { _eq: adminUserId } },
      fields: PREFS_FIELDS,
      limit: 1,
    },
  )
  const row = result.data[0]
  if (!row) return null
  const parsed = validatePreferences({
    admin_user: row.admin_user,
    email_enabled: row.email_enabled,
    telegram_enabled: row.telegram_enabled,
    whatsapp_enabled: row.whatsapp_enabled,
    cadence: row.cadence,
    sections: row.sections,
  })
  if (!parsed.ok) return null
  return parsed.value
}

/** Scoped task rows for the digest (same predicate as GET /api/tasks). */
export async function collectTasksDigest(
  event: H3Event,
  scope: PortalScope,
  options: { assignedToMe?: boolean; limit?: number } = {},
): Promise<DigestTaskRow[]> {
  requireCan(scope, 'tasks', 'read')
  const limit = Math.min(200, Math.max(1, options.limit ?? 200))
  const rows = await tryListDomain<Record<string, unknown>>(event, scope, 'tasks', {
    filter: mergeFilters(
      officeBranchScope(scope),
      options.assignedToMe
        ? { assignee_user: { _eq: scope.session.user.id } }
        : undefined,
    ),
    fields: TASK_DIGEST_FIELDS,
    limit,
  })
  logScopedQuery(scope, 'notify.digest.tasks', { rows: rows.length })
  return rows.map(toTaskRow)
}

/** Scoped celebration items for the digest (same feed + roll-up as the list). */
export async function collectCelebrationsDigest(
  event: H3Event,
  scope: PortalScope,
  window: { from: string; to: string },
): Promise<{ items: CelebrationRow[]; total: number }> {
  const filters: CelebrationFeedFilters = {
    branch: null,
    zone: null,
    type: null,
    visibility: null,
    status: 'approved',
    month: null,
    day: null,
    date_from: window.from,
    date_to: window.to,
    page: 1,
    limit: 25,
    sort: null,
  }
  try {
    const [feed, rollup] = await Promise.all([
      collectCelebrations(event, scope, filters),
      celebrationsRollup(event, scope, {}, { from: window.from, to: window.to }),
    ])
    logScopedQuery(scope, 'notify.digest.celebrations', {
      rows: feed.rows.length,
      total: rollup.total,
    })
    return { items: feed.rows, total: rollup.total }
  } catch {
    // A refused celebrations read degrades to an empty section, never a
    // failed digest (feed fail-soft, office.ts precedent).
    return { items: [], total: 0 }
  }
}

/** Scoped upcoming events for the digest (same predicate as GET /api/events). */
export async function collectUpcomingEventsDigest(
  event: H3Event,
  scope: PortalScope,
  window: { from: string; to: string },
  limit = 50,
): Promise<
  Array<{ id: string; title: string; start_at: string; location: string | null }>
> {
  requireCan(scope, 'events', 'read')
  const rows = await tryListDomain<Record<string, unknown>>(event, scope, 'events', {
    filter: mergeFilters(
      { start_at: { _gte: window.from } },
      { start_at: { _lte: window.to } },
      eventScopeFilter(scope),
    ),
    fields: EVENT_DIGEST_FIELDS,
    sort: 'start_at',
    limit: Math.min(200, Math.max(1, limit)),
  })
  logScopedQuery(scope, 'notify.digest.events', { rows: rows.length })
  return rows.map((row) => ({
    id: String(row.id ?? ''),
    title: typeof row.title === 'string' ? row.title : 'Untitled event',
    start_at: typeof row.start_at === 'string' ? row.start_at : '',
    location: typeof row.location === 'string' ? row.location : null,
  }))
}

interface AuditTrailRow {
  action: string
  actor: string
  at: string
  detail: string | null
}

/** One audit trail, fail-soft: a missing collection contributes zero rows. */
async function collectTrail(
  event: H3Event,
  scope: PortalScope,
  collection: string,
  actionOf: (row: Record<string, unknown>) => string,
  actorOf: (row: Record<string, unknown>) => string,
  atOf: (row: Record<string, unknown>) => string,
  detailOf: (row: Record<string, unknown>) => string | null,
  dateField: string,
  since: string,
  limit: number,
): Promise<AuditTrailRow[]> {
  const rows = await tryListDomain<Record<string, unknown>>(event, scope, collection, {
    filter: { [dateField]: { _gte: since } },
    fields: [
      'id',
      'event_type',
      'action',
      'actor',
      'actor_user',
      'detail',
      'reason',
      'created_at',
      'started_at',
    ],
    sort: `-${dateField}`,
    limit,
  })
  return rows.map((row) => ({
    action: actionOf(row),
    actor: actorOf(row),
    at: atOf(row),
    detail: detailOf(row),
  }))
}

function textOf(row: Record<string, unknown>, ...keys: string[]): string | null {
  for (const key of keys) {
    const value = row[key]
    if (typeof value === 'string' && value.length > 0) return value
  }
  return null
}

/**
 * System-activity rows: recent office audit trails plus the impersonation
 * audit log. Non-area callers cannot read the impersonation log (AFC-684:
 * area-wide log for area staff only) — that domain contributes zero rows
 * for them instead of failing the digest.
 */
export async function collectActivityDigest(
  event: H3Event,
  scope: PortalScope,
  since: string,
  limitPerDomain = 25,
): Promise<DigestActivityRow[]> {
  const limit = Math.min(100, Math.max(1, limitPerDomain))
  const [tasks, announcements, impersonations] = await Promise.all([
    collectTrail(
      event,
      scope,
      'task_events',
      (row) => `task ${textOf(row, 'event_type') ?? 'note'}`,
      (row) => textOf(row, 'actor_user') ?? 'unknown',
      (row) => textOf(row, 'created_at') ?? '',
      (row) => textOf(row, 'detail'),
      'created_at',
      since,
      limit,
    ),
    collectTrail(
      event,
      scope,
      'announcement_events',
      (row) => `announcement ${textOf(row, 'event_type') ?? 'note'}`,
      (row) => textOf(row, 'actor_user') ?? 'unknown',
      (row) => textOf(row, 'created_at') ?? '',
      (row) => textOf(row, 'detail'),
      'created_at',
      since,
      limit,
    ),
    collectTrail(
      event,
      scope,
      IMPERSONATION_AUDIT_COLLECTION,
      (row) => `impersonation ${textOf(row, 'action') ?? 'started'}`,
      (row) => textOf(row, 'actor') ?? 'unknown',
      (row) => textOf(row, 'started_at') ?? '',
      (row) => textOf(row, 'reason'),
      'started_at',
      since,
      limit,
    ),
  ])
  const merged = [...tasks, ...announcements, ...impersonations]
    .filter((row) => row.at.length > 0)
    .sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0))
  logScopedQuery(scope, 'notify.digest.activity', { rows: merged.length })
  return merged.map((row) => ({
    action: row.action,
    actor: row.actor,
    at: row.at,
    detail: row.detail,
  }))
}

function toCalendarEntries(
  items: CalendarItem[],
): Array<{ title: string; date: string }> {
  return items.map((item) => ({ title: item.title, date: item.date }))
}

/**
 * Build one admin's digest. Null when unconfigured (no preference row) or
 * muted (no channel on): the phase-2 scheduler sends only non-null
 * digests, so "no row" and "no channels" can never become a broadcast.
 * Content only — no send, no schedule, no secrets.
 */
export async function buildAdminDigest(
  event: H3Event,
  options: { adminUserId: string; today: string },
): Promise<AdminDigest | null> {
  const scope = await getPortalScope(event)
  const prefs = await getNotificationPreferences(event, scope, options.adminUserId)
  if (!prefs) return null
  const channels = enabledChannels(prefs)
  if (channels.length === 0) return null

  const window = digestWindow(prefs.cadence, options.today)
  const sections: DigestSection[] = []

  if (prefs.sections.includes('tasks')) {
    const tasks = await collectTasksDigest(event, scope)
    sections.push(tasksDigestSection(tasks, options.today, isTaskOverdue))
  }
  if (prefs.sections.includes('celebrations')) {
    const { items, total } = await collectCelebrationsDigest(event, scope, window)
    const merged = combineCalendarFeed(
      { celebration: celebrationsToCalendarItems(items, window) },
      { dateFrom: window.from, dateTo: window.to, limit: MAX_DIGEST_LINES },
    )
    const section = upcomingDigestSection(
      'celebrations',
      'Celebrations',
      toCalendarEntries(merged),
    )
    if (total > items.length) {
      section.lines.push(`+ ${total - items.length} more approved in range`)
    }
    sections.push(section)
  }
  if (prefs.sections.includes('events')) {
    const rows = await collectUpcomingEventsDigest(event, scope, window)
    const merged = combineCalendarFeed(
      {
        event: rows.map((row) => ({
          id: row.id,
          item_type: 'event' as const,
          title: row.title,
          date: row.start_at.slice(0, 10),
          starts_at: row.start_at,
          branch: null,
          zone: null,
          href: `/events/${row.id}`,
        })),
      },
      { dateFrom: window.from, dateTo: window.to, limit: MAX_DIGEST_LINES },
    )
    sections.push(
      upcomingDigestSection('events', 'Upcoming events', toCalendarEntries(merged)),
    )
  }
  if (prefs.sections.includes('activity')) {
    const rows = await collectActivityDigest(event, scope, options.today)
    sections.push(activityDigestSection(rows))
  }

  return {
    channels,
    cadence: prefs.cadence,
    content: buildDigestContent({
      cadence: prefs.cadence,
      date: options.today,
      sections,
    }),
  }
}
