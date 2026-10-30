/**
 * Admin notification digest content (AFC-903 phase 1, chairman ask
 * 2026-10-29: realtime notifications plus daily/weekly/monthly lists of
 * tasks, celebrations, upcoming events and system activity over Email,
 * Telegram and WhatsApp).
 *
 * Phase 1 is CONTENT ONLY. This module validates the preference record
 * and renders digest text; it never sends anything. There are no
 * transport calls, no provider SDKs, no tokens and no secrets here —
 * delivery is phase 2 (outbox + scheduler) and phase 3 (provider wiring),
 * and `shouldDeliver` fails closed while no transport is configured,
 * which in phase 1 is always.
 *
 * Dependency-free by design (message-tokens.ts precedent): this module
 * imports nothing, so the node --test contract and every consumer read
 * exactly what is here. Reuse of the owned business rules happens at the
 * call site, by injection, and the contract pins each injection:
 *   overdue rule   the server util passes `isTaskOverdue` (owned by
 *                  office-feed.ts — the same predicate the task board and
 *                  the task audit trail read), so the digest can never
 *                  disagree with the board about what is late.
 *   ordering/clip  the server util orders and window-clips upcoming items
 *                  with `combineCalendarFeed` (owned by office-feed.ts —
 *                  the same merge the calendar route renders) before
 *                  formatting them here, so the digest lists upcoming
 *                  items in the same order the calendar shows them.
 * The Celebration/Event rows themselves are read by the server util with
 * the existing scoped collectors (`collectCelebrations`,
 * `celebrationsRollup`, the tasks/events scope predicates).
 */

export const NOTIFICATION_CHANNELS = ['email', 'telegram', 'whatsapp'] as const
export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number]

export const DIGEST_CADENCES = ['realtime', 'daily', 'weekly', 'monthly'] as const
export type DigestCadence = (typeof DIGEST_CADENCES)[number]

export const DIGEST_SECTIONS = ['tasks', 'celebrations', 'events', 'activity'] as const
export type DigestSectionKey = (typeof DIGEST_SECTIONS)[number]

/** Longest any one digest section may grow; the rest stays a count. */
export const MAX_DIGEST_LINES = 8

export interface NotificationPreferences {
  admin_user: string
  email_enabled: boolean
  telegram_enabled: boolean
  whatsapp_enabled: boolean
  cadence: DigestCadence
  sections: DigestSectionKey[]
}

export interface DigestTaskRow {
  id: string
  title: string
  status: string
  due_date: string | null
  priority: string | null
}

export interface DigestUpcomingEntry {
  title: string
  date: string
}

export interface DigestActivityRow {
  action: string
  actor: string
  at: string
  detail: string | null
}

export interface DigestWindow {
  /** Inclusive lower bound (YYYY-MM-DD). */
  from: string
  /** Inclusive upper bound (YYYY-MM-DD). */
  to: string
}

export interface DigestSection {
  key: DigestSectionKey
  title: string
  lines: string[]
}

export interface DigestContent {
  subject: string
  body: string
}

export function isDigestCadence(value: unknown): value is DigestCadence {
  return (
    typeof value === 'string' && (DIGEST_CADENCES as readonly string[]).includes(value)
  )
}

export function isDigestSection(value: unknown): value is DigestSectionKey {
  return (
    typeof value === 'string' && (DIGEST_SECTIONS as readonly string[]).includes(value)
  )
}

type ValidPreferences = { ok: true; value: NotificationPreferences }
type InvalidPreferences = { ok: false; errors: string[] }

/**
 * Validate an untrusted preference payload (route input). Fails closed:
 * anything the register would refuse — blank admin, non-boolean switch,
 * unknown cadence, unknown section — is an error, never a default.
 */
export function validatePreferences(
  input: unknown,
): ValidPreferences | InvalidPreferences {
  const errors: string[] = []
  if (input === null || typeof input !== 'object') {
    return { ok: false, errors: ['preferences must be an object'] }
  }
  const row = input as Record<string, unknown>

  const adminUser = row.admin_user
  if (typeof adminUser !== 'string' || adminUser.trim().length === 0) {
    errors.push('admin_user must be a non-blank user id')
  }
  for (const key of ['email_enabled', 'telegram_enabled', 'whatsapp_enabled']) {
    if (typeof row[key] !== 'boolean') errors.push(`${key} must be a boolean`)
  }
  if (!isDigestCadence(row.cadence)) {
    errors.push(`cadence must be one of ${DIGEST_CADENCES.join(', ')}`)
  }
  const sections = row.sections
  if (
    !Array.isArray(sections) ||
    !sections.every((section) => isDigestSection(section))
  ) {
    errors.push(`sections must be an array of ${DIGEST_SECTIONS.join(', ')}`)
  }
  if (errors.length > 0) return { ok: false, errors }
  return {
    ok: true,
    value: {
      admin_user: (adminUser as string).trim(),
      email_enabled: row.email_enabled as boolean,
      telegram_enabled: row.telegram_enabled as boolean,
      whatsapp_enabled: row.whatsapp_enabled as boolean,
      cadence: row.cadence as DigestCadence,
      sections: (sections as DigestSectionKey[]).slice(),
    },
  }
}

/** Channels the admin switched on, in send order. */
export function enabledChannels(prefs: NotificationPreferences): NotificationChannel[] {
  const channels: NotificationChannel[] = []
  if (prefs.email_enabled) channels.push('email')
  if (prefs.telegram_enabled) channels.push('telegram')
  if (prefs.whatsapp_enabled) channels.push('whatsapp')
  return channels
}

/**
 * Delivery gate for the phase-2 scheduler. Null preferences (unconfigured),
 * an all-off mute, or an unprovisioned transport all refuse: nothing is
 * ever sent on a maybe. Phase 1 passes `{ configured: false }` always —
 * the builder below still produces text for preview, but no send path
 * exists to call this `true`.
 */
export function shouldDeliver(
  prefs: NotificationPreferences | null,
  transport: { configured: boolean },
): boolean {
  if (!prefs) return false
  if (enabledChannels(prefs).length === 0) return false
  if (!transport.configured) return false
  return true
}

function addDaysISO(date: string, days: number): string {
  const parts = date.split('-').map(Number)
  const year = parts[0] ?? 0
  const month = parts[1] ?? 0
  const day = parts[2] ?? 0
  const rolled = new Date(Date.UTC(year, month - 1, day + days))
  return rolled.toISOString().slice(0, 10)
}

function isDateString(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const parts = value.split('-').map(Number)
  const year = parts[0] ?? 0
  const month = parts[1] ?? 0
  const day = parts[2] ?? 0
  const roundTrip = new Date(Date.UTC(year, month - 1, day)).toISOString().slice(0, 10)
  return roundTrip === value
}

/**
 * Digest window for a cadence starting today (pure, so the scheduler and
 * the preview render the same range). Realtime has no digest window of its
 * own — per-event sends are phase 2 — so its content builder covers today.
 */
export function digestWindow(cadence: DigestCadence, today: string): DigestWindow {
  if (!isDateString(today)) {
    throw new Error(`digestWindow needs a YYYY-MM-DD date, got ${JSON.stringify(today)}`)
  }
  if (cadence === 'weekly') return { from: today, to: addDaysISO(today, 6) }
  if (cadence === 'monthly') return { from: today, to: addDaysISO(today, 29) }
  return { from: today, to: today }
}

/**
 * Tasks section. The overdue predicate arrives injected: the server util
 * passes `isTaskOverdue`, the single overdue rule the task board and the
 * task audit trail read — this module never copies it.
 */
export function tasksDigestSection(
  tasks: DigestTaskRow[],
  today: string,
  isOverdue: (task: { due_date: string | null; status: string }) => boolean,
): DigestSection {
  const open = tasks.filter(
    (task) => task.status !== 'done' && task.status !== 'cancelled',
  )
  const overdue = open.filter((task) => isOverdue(task))
  const dueToday = open.filter((task) => task.due_date === today)
  const rest = open.filter((task) => !overdue.includes(task) && !dueToday.includes(task))
  const ordered = [...overdue, ...dueToday, ...rest]
  const lines =
    open.length === 0
      ? ['Nothing open.']
      : [
          `${open.length} open · ${overdue.length} overdue · ${dueToday.length} due today`,
          ...ordered.slice(0, MAX_DIGEST_LINES).map((task) => {
            const due = task.due_date ?? 'no due date'
            return `• ${task.title} (${due}, ${task.status})`
          }),
        ]
  return { key: 'tasks', title: 'Tasks', lines }
}

/**
 * Upcoming-items section over pre-ordered, pre-clipped entries. Ordering
 * and window clipping are the caller's job — the server util runs them
 * through `combineCalendarFeed`, the same merge the calendar route
 * renders — so this module formats but never re-sorts.
 */
export function upcomingDigestSection(
  key: DigestSectionKey,
  title: string,
  entries: DigestUpcomingEntry[],
): DigestSection {
  return {
    key,
    title,
    lines:
      entries.length === 0
        ? ['Nothing in this window.']
        : entries
            .slice(0, MAX_DIGEST_LINES)
            .map((entry) => `• ${entry.title} — ${entry.date}`),
  }
}

/** System-activity section over recent audit-trail rows (newest first). */
export function activityDigestSection(events: DigestActivityRow[]): DigestSection {
  if (events.length === 0) {
    return { key: 'activity', title: 'System activity', lines: ['Nothing recorded.'] }
  }
  const byAction = new Map<string, number>()
  for (const row of events) byAction.set(row.action, (byAction.get(row.action) ?? 0) + 1)
  const summary = [...byAction.entries()]
    .map(([action, count]) => `${count} ${action}`)
    .join(' · ')
  const ordered = events.slice(0, MAX_DIGEST_LINES).map((row) => {
    const detail = row.detail ? ` — ${row.detail}` : ''
    return `• ${row.action}${detail} (${row.at})`
  })
  return { key: 'activity', title: 'System activity', lines: [summary, ...ordered] }
}

/**
 * One subject + one plain-text body for every channel. Channel-specific
 * rendering (length caps, markup) is phase 3; phase 1 text must read
 * whole on all three.
 */
export function buildDigestContent(input: {
  cadence: DigestCadence
  date: string
  sections: DigestSection[]
}): DigestContent {
  const subject = `Admin digest · ${input.cadence} · ${input.date}`
  const blocks = input.sections.map((section) => {
    const lines = section.lines.length > 0 ? section.lines : ['(nothing new)']
    return [`## ${section.title} (${lines.length})`, ...lines].join('\n')
  })
  const body = [
    `Admin digest (${input.cadence}) for ${input.date}.`,
    '',
    ...(blocks.length > 0 ? blocks : ['No sections enabled.']),
    '',
    'Manage these in Admin → Notifications.',
  ].join('\n')
  return { subject, body }
}
