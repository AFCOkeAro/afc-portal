import { createHash } from 'node:crypto'
import type { H3Event } from 'h3'
import type { PortalScope } from './portal'
import { createItem, deleteItem } from './portal'
import { directusFetch } from './directus'

/**
 * Member event invitations — route-layer helpers (AFC-480, data-model-v4 §3
 * + §5, prd-addendum-v4 §3 + US-E1..E4, ADR-0009 decisions 1-2).
 *
 * DB enforcement lives in migration 20261020_0005 (event_invites CHECKs,
 * invite_rate_gate/invite_eligibility/invite_contact_suppressed). This file
 * is the HTTP half: validation, preview rendering, member redaction and the
 * capability split. It deliberately does NOT import the shared role matrix:
 * the matrix file carries sibling-track hunks and this slice must not ship
 * them, so the invite capability table below is local and minimal. When the
 * matrix gains the event_invites row (data-model-v4 §5), these two tables
 * must agree -- the web contract test pins the member-visible shape.
 *
 * Member identity (track d) does not exist yet: no login role carries a
 * member_person link, so every session today is a staff session. The member
 * path below is therefore written future-proof (inviter_user = session user
 * + redacted read) but unreachable until the OTP role lands behind the
 * SecurityEngineer gate (ADR-0009 decision 6). A member-shaped session that
 * arrives early gets the member path, never staff breadth.
 */

export const INVITE_STATUSES = [
  'pending_approval',
  'queued',
  'sent',
  'delivered',
  'failed',
  'blocked_optout',
  'blocked_rate_limit',
  'withdrawn',
  'registered',
] as const

export type InviteStatus = (typeof INVITE_STATUSES)[number]

export const INVITE_CHANNELS = ['whatsapp', 'sms', 'auto'] as const
export type InviteChannel = (typeof INVITE_CHANNELS)[number]

export const INVITE_AGE_BANDS = ['adult', 'youth', 'teen', 'child', 'unknown'] as const
export type InviteAgeBand = (typeof INVITE_AGE_BANDS)[number]

export const INVITE_RELATIONSHIPS = [
  'friend',
  'family',
  'coworker',
  'neighbour',
  'invited_by_guest',
  'other',
] as const

export interface InviteRow {
  id: string
  event: string
  branch: string | null
  inviter_person: string | null
  inviter_user: string | null
  invitee_name: string | null
  invitee_phone: string | null
  invitee_contact_hash: string | null
  invitee_relationship: string | null
  invitee_age_band: string | null
  guardian_phone: string | null
  channel_choice: string | null
  consent_basis: string | null
  message_template: string | null
  message_rendered: string | null
  variables_snapshot: Record<string, unknown> | null
  communication: string | null
  recipient: string | null
  status: string | null
  approval_required: boolean | null
  approved_by: string | null
  approved_at: string | null
  blocked_reason: string | null
  retry_of: string | null
  created_at: string | null
}

export const INVITE_FIELDS = [
  'id',
  'event',
  'branch',
  'inviter_person',
  'inviter_user',
  'invitee_name',
  'invitee_phone',
  'invitee_contact_hash',
  'invitee_relationship',
  'invitee_age_band',
  'guardian_phone',
  'channel_choice',
  'consent_basis',
  'message_template',
  'message_rendered',
  'variables_snapshot',
  'communication',
  'recipient',
  'status',
  'approval_required',
  'approved_by',
  'approved_at',
  'blocked_reason',
  'retry_of',
  'created_at',
]

export interface InviteCapabilities {
  /** May submit invites (member: own only; staff: their branch). */
  create: boolean
  /** May read rows (member: own only, redacted; staff: branch scope, full). */
  read: boolean
  /** Sees contact value, guardian number and rendered text. */
  readFull: boolean
  /** May approve pending/blocked_rate_limit rows (branch admin and above). */
  approve: boolean
  /** May retry a failed send once (branch admin and above). */
  retry: boolean
  /** May export CSV (branch admin and above; never members). */
  exportCsv: boolean
}

/**
 * Local capability table for event_invites (data-model-v4 §5 row, staff
 * roles only -- welfare-officer/member grants live in the Directus policy).
 * Roles below branch admin hold no invite grant at all.
 */
export function inviteCapabilities(role: string): InviteCapabilities {
  switch (role) {
    case 'super_admin':
    case 'area_admin':
      return {
        create: true,
        read: true,
        readFull: true,
        approve: true,
        retry: true,
        exportCsv: true,
      }
    case 'zone_admin':
    case 'branch_admin':
      return {
        create: true,
        read: true,
        readFull: true,
        approve: true,
        retry: true,
        exportCsv: true,
      }
    case 'member':
      return {
        create: true,
        read: true,
        readFull: false,
        approve: false,
        retry: false,
        exportCsv: false,
      }
    default:
      return {
        create: false,
        read: false,
        readFull: false,
        approve: false,
        retry: false,
        exportCsv: false,
      }
  }
}

export function requireInviteCap(
  caps: InviteCapabilities,
  cap: keyof InviteCapabilities,
  action: string,
): void {
  if (caps[cap]) return
  throw createError({
    statusCode: 403,
    statusMessage: `Your role cannot ${action} event invitations`,
    data: { code: 'forbidden' },
  })
}

/** A member-shaped session gets the member path, never staff breadth.
 *  Compared as a string: the member role (track d) is not a StaffRole yet,
 *  and widening that union is the role-matrix owner's change, not this
 *  slice's. */
export function isMemberSession(scope: PortalScope): boolean {
  return (scope.role as string) === 'member'
}

/**
 * Member-safe projection: own rows with the phone redacted and internals
 * removed (data-model-v4 §5.1: the inviting member sees only their own
 * record and a redacted phone `0801 ••• •234`, plus status).
 */
export function redactInviteForMember(row: InviteRow): Record<string, unknown> {
  return {
    id: String(row.id),
    event: row.event,
    channel_choice: row.channel_choice,
    invitee_name: row.invitee_name,
    invitee_phone_redacted: redactInvitePhone(row.invitee_phone),
    invitee_age_band: row.invitee_age_band,
    status: row.status,
    approval_required: row.approval_required ?? false,
    blocked_reason:
      row.status === 'blocked_rate_limit' || row.status === 'pending_approval'
        ? (row.blocked_reason ?? null)
        : null,
    created_at: row.created_at,
  }
}

export function projectInviteRow(
  scope: PortalScope,
  caps: InviteCapabilities,
  row: InviteRow,
): Record<string, unknown> {
  if (!caps.readFull || isMemberSession(scope)) return redactInviteForMember(row)
  return { ...row, id: String(row.id) }
}

/** `0801 ••• •234`: first four + last four, nothing in between. */
export function redactInvitePhone(phone: string | null | undefined): string {
  const text = (phone ?? '').trim()
  if (text.length < 7) return '••••'
  return `${text.slice(0, 4)} ••• ${text.slice(-4)}`
}

/** Trim + drop cosmetic separators. No country-code rewriting: the writer
 *  stores what the member typed (trimmed); canonicalisation is a Flow/capture
 *  concern, not a silent rewrite in the route. */
export function normalizeInvitePhone(phone: unknown): string {
  if (typeof phone !== 'string') return ''
  return phone.trim().replace(/[\s\-().]+/g, '')
}

export function hashInvitePhone(normalised: string): string {
  return `sha256:${createHash('sha256').update(normalised, 'utf8').digest('hex')}`
}

export function isMinorBand(band: string | null | undefined): boolean {
  return band === 'child' || band === 'teen'
}

/**
 * F5 guardian rule (AFC-512): unknown age band defaults to the guardian
 * path -- an invite whose age band is not provably adult travels with a
 * guardian number and a staff-confirmable attestation. `youth` stays on
 * the adult path (youth profiles are staff-managed, US-Y1); only
 * child/teen/unknown require the guardian.
 */
export function requiresGuardianBand(band: string | null | undefined): boolean {
  return band === 'child' || band === 'teen' || band === 'unknown'
}

/** F7: inviter note bound -- 140 chars, rendered delimited from the body. */
export const INVITER_NOTE_MAX_LENGTH = 140

const INVITER_NOTE_URL_RE = /(https?:\/\/|www\.)/i
const INVITER_NOTE_PHONE_RE = /(\+?\d[\d\s\-().]{6,}\d)/

/**
 * F7 note hygiene: bounded length, no URLs, no phone numbers. Returns the
 * trimmed note when clean, otherwise the caller records a validation
 * field (the note is never silently stripped: a member who pastes a link
 * learns why it was refused).
 */
export function validateInviterNote(note: unknown): {
  note: string
  error: string | null
} {
  const text = typeof note === 'string' ? note.trim() : ''
  if (!text) return { note: '', error: null }
  if (text.length > INVITER_NOTE_MAX_LENGTH) {
    return {
      note: '',
      error: `Keep the note to ${INVITER_NOTE_MAX_LENGTH} characters so it fits one message`,
    }
  }
  if (INVITER_NOTE_URL_RE.test(text)) {
    return {
      note: '',
      error:
        'Links are not allowed in the note; the invitation carries the official RSVP link',
    }
  }
  if (INVITER_NOTE_PHONE_RE.test(text)) {
    return {
      note: '',
      error:
        'Phone numbers are not allowed in the note; the invitee number is already on the invitation',
    }
  }
  return { note: text, error: null }
}

/** F7: the note is delimited from the official body, never interpolated. */
export function formatInviteNoteDelimited(note: string): string {
  const text = note.trim()
  if (!text) return ''
  return ` — Note from inviter: "${text}"`
}

/**
 * F2 forged-identity rejection (AFC-478 F2, AFC-512 S8): the invite routes
 * accept NO inviter_* fields at all -- identity comes from the session
 * only. A body carrying any of them is rejected with 403 (never silently
 * overwritten: silent overwrite hides confused-deputy bugs, and a member
 * creating an invite as another person gets 403).
 */
export function throwOnForgedInviterIdentity(body: Record<string, unknown>): void {
  for (const field of ['inviter_person', 'inviter_user', 'inviter', 'inviter_id']) {
    if (
      body[field] !== undefined &&
      body[field] !== null &&
      String(body[field]).trim() !== ''
    ) {
      throw createError({
        statusCode: 403,
        statusMessage:
          'Inviter identity comes from your login; do not send inviter fields',
        data: { code: 'inviter_identity_forged', field },
      })
    }
  }
}

export interface InvitePreviewVariables {
  invitee_name: string
  inviter_name: string
  event_name: string
  event_datetime: string
  event_location: string
  branch_name: string
  inviter_note: string
  rsvp_link: string
}

/**
 * Board sentence (prd-addendum-v4 §3.1) rendered before queue
 * (US-E1 AC2: the member sees the exact text before confirming, no blind
 * sends). Single send only: the route states that further messages need a
 * real consent grant (§3.3 -- no drip). F7: the inviter note is appended
 * delimited from the official body via formatInviteNoteDelimited, so a
 * member note can never be mistaken for official instructions.
 */
export function renderInvitePreview(vars: InvitePreviewVariables): string {
  const note = formatInviteNoteDelimited(vars.inviter_note ?? '')
  const location = vars.event_location.trim() ? ` at ${vars.event_location.trim()}` : ''
  return (
    `Dear ${vars.invitee_name}, ${vars.inviter_name} is inviting you to ` +
    `${vars.event_name} ${vars.event_datetime}${location}.${note} ` +
    `Details: ${vars.rsvp_link} Reply STOP to opt out of future messages.`
  )
}

export interface InviteEventBrief {
  id: string
  title: string
  branch: string | null
  visibility: string
  invite_eligible: boolean
  invite_requires_approval: boolean
  start_at: string | null
  location: string | null
}

/** Best-effort event brief: unknown columns read as the permissive default
 *  only where the schema cannot prove otherwise is wrong -- invite_eligible
 *  defaults true (data-model-v4 §3.3), visibility defaults public. A missing
 *  event is a 404, never an open invite. */
export async function loadInviteEvent(
  event: H3Event,
  scope: PortalScope,
  eventId: string,
): Promise<InviteEventBrief> {
  const row = await directusFetch<{ data: Record<string, unknown> }>(
    event,
    `/items/events/${eventId}`,
    {
      accessToken: scope.token,
      query: {
        fields:
          'id,title,branch,visibility,invite_eligible,invite_requires_approval,start_at,location,live_join_url',
      },
    },
  ).then(
    (response) => response.data,
    () => {
      throw createError({
        statusCode: 404,
        statusMessage: 'That event was not found in your scope',
        data: { code: 'not_found' },
      })
    },
  )
  return {
    id: String(row.id),
    title: typeof row.title === 'string' ? row.title : 'Church event',
    branch: typeof row.branch === 'string' ? row.branch : null,
    visibility: typeof row.visibility === 'string' ? row.visibility : 'public',
    invite_eligible:
      row.invite_eligible === undefined ? true : row.invite_eligible === true,
    invite_requires_approval: row.invite_requires_approval === true,
    start_at: typeof row.start_at === 'string' ? row.start_at : null,
    location: typeof row.location === 'string' ? row.location : null,
  }
}

/**
 * STOP/opt-out pre-check (best-effort UX): true when consent_records holds
 * a granted=false messaging-channel row for the hash. The send path stays
 * authoritative via invite_contact_suppressed() + the 0004 resolver, so a
 * failed read here fails OPEN to creation (the send still cannot go out)
 * rather than refusing a legitimate invite on a transient read error.
 */
export async function isInviteSuppressed(
  event: H3Event,
  scope: PortalScope,
  contactHash: string,
): Promise<boolean> {
  try {
    const response = await directusFetch<{ data: unknown[] }>(
      event,
      '/items/consent_records',
      {
        accessToken: scope.token,
        query: {
          fields: 'id',
          limit: 1,
          filter: {
            contact_hash: { _eq: contactHash },
            channel: { _in: ['whatsapp', 'sms'] },
            granted: { _eq: false },
          },
        },
      },
    )
    return response.data.length > 0
  } catch {
    return false
  }
}

export interface InviteWindowCounts {
  sent24h: number
  sent7d: number
}

/** Rolling-window counts for the inviter (Directus $NOW filters). A failed
 *  count fails CLOSED to zero-with-a-flag: the caller treats unknown counts
 *  as within limits for UX but the DB gate stays authoritative. The flag is
 *  returned so the route can say which path it took. */
export async function countInviterWindows(
  event: H3Event,
  scope: PortalScope,
  inviterUserId: string,
): Promise<InviteWindowCounts & { countsVerified: boolean }> {
  try {
    const [day, week] = await Promise.all([
      directusFetch<{ meta?: { filter_count?: number } }>(event, '/items/event_invites', {
        accessToken: scope.token,
        query: {
          limit: 1,
          meta: 'filter_count',
          filter: {
            inviter_user: { _eq: inviterUserId },
            created_at: { _gte: '$NOW(-1 day)' },
          },
        },
      }),
      directusFetch<{ meta?: { filter_count?: number } }>(event, '/items/event_invites', {
        accessToken: scope.token,
        query: {
          limit: 1,
          meta: 'filter_count',
          filter: {
            inviter_user: { _eq: inviterUserId },
            created_at: { _gte: '$NOW(-7 days)' },
          },
        },
      }),
    ])
    return {
      sent24h: day.meta?.filter_count ?? 0,
      sent7d: week.meta?.filter_count ?? 0,
      countsVerified: true,
    }
  } catch {
    return { sent24h: 0, sent7d: 0, countsVerified: false }
  }
}

/** Per-member limits with the schema defaults (10/day, 50/week,
 *  data-model-v4 §3.2). Best-effort read; unknown users get defaults. */
export async function readMemberLimits(
  event: H3Event,
  scope: PortalScope,
  userId: string,
): Promise<{ daily: number; weekly: number }> {
  try {
    const response = await directusFetch<{ data: Record<string, unknown> }>(
      event,
      `/users/${userId}`,
      {
        accessToken: scope.token,
        query: { fields: 'invite_daily_limit,invite_weekly_limit' },
      },
    )
    const daily = Number(response.data.invite_daily_limit)
    const weekly = Number(response.data.invite_weekly_limit)
    return {
      daily: Number.isInteger(daily) && daily >= 0 ? daily : 10,
      weekly: Number.isInteger(weekly) && weekly >= 0 ? weekly : 50,
    }
  } catch {
    return { daily: 10, weekly: 50 }
  }
}

export function throwInviteValidation(
  fields: Record<string, string>,
  message = 'Some invite fields need attention',
): never {
  throw createError({
    statusCode: 400,
    statusMessage: message,
    data: { code: 'validation_error', fields },
  })
}

/**
 * Lagos calendar keys (AFC-516, ADR-0011). The quota windows are calendar
 * windows in Africa/Lagos, not rolling 24h/7d: the daily window resets at
 * 00:00 Lagos, the weekly window is Monday-to-Sunday Lagos. Pure and
 * unit-testable: the caller passes the clock.
 */

/** YYYY-MM-DD of `now` in Africa/Lagos. */
export function lagosDayKey(now: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Lagos',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now)
  const get = (type: string): string =>
    parts.find((part) => part.type === type)?.value ?? ''
  return `${get('year')}-${get('month')}-${get('day')}`
}

/** YYYY-MM-DD of the Monday of `now`'s Africa/Lagos week (Mon-Sun). */
export function lagosWeekMonday(now: Date): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Africa/Lagos',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
  }).formatToParts(now)
  const get = (type: string): number =>
    Number(parts.find((part) => part.type === type)?.value ?? 0)
  // Arithmetic on the Lagos calendar date in UTC: the weekday of a calendar
  // date is timezone-independent, so getUTCDay of the YMD triple is the
  // Lagos weekday (0 = Sunday .. 6 = Saturday).
  const lagosDate = new Date(Date.UTC(get('year'), get('month') - 1, get('day')))
  lagosDate.setUTCDate(lagosDate.getUTCDate() - ((lagosDate.getUTCDay() + 6) % 7))
  const pad = (value: number): string => String(value).padStart(2, '0')
  return (
    `${lagosDate.getUTCFullYear()}-` +
    `${pad(lagosDate.getUTCMonth() + 1)}-${pad(lagosDate.getUTCDate())}`
  )
}

export interface InviteQuotaLimits {
  daily: number
  weekly: number
}

export type InviteQuotaClaim =
  { allowed: true; release: () => Promise<void> } | { allowed: false }

/**
 * True when a Directus write error is a uniqueness conflict. Directus
 * surfaces a UNIQUE violation as a 400 whose message names the constraint
 * ("unique", case-insensitive) or whose extensions code carries a uniqueness
 * marker. Anything else is a different failure and must fail closed.
 */
export function isUniqueViolation(error: unknown): boolean {
  const err = error as {
    statusCode?: number
    status?: number
    statusMessage?: string
    message?: string
    data?: {
      code?: string
      errors?: Array<{ message?: string; extensions?: { code?: string } }>
    }
  }
  const status = err?.statusCode ?? err?.status ?? 0
  if (status !== 400) return false
  const haystacks: string[] = []
  if (typeof err?.statusMessage === 'string') haystacks.push(err.statusMessage)
  if (typeof err?.message === 'string') haystacks.push(err.message)
  if (typeof err?.data?.code === 'string') haystacks.push(err.data.code)
  for (const entry of err?.data?.errors ?? []) {
    if (typeof entry?.message === 'string') haystacks.push(entry.message)
    if (typeof entry?.extensions?.code === 'string') haystacks.push(entry.extensions.code)
  }
  return haystacks.some((text) => /unique/i.test(text))
}

async function claimQuotaSlot(
  event: H3Event,
  scope: PortalScope,
  inviterUserId: string,
  period: 'day' | 'week',
  periodStart: string,
  limit: number,
): Promise<string | null> {
  for (let slot = 0; slot < limit; slot++) {
    try {
      const row = await createItem<{ id: string | number }>(
        event,
        scope,
        'invite_quota_slots',
        {
          inviter_user: inviterUserId,
          period,
          period_start: periodStart,
          slot_no: slot,
        },
      )
      return String(row.id)
    } catch (error) {
      // Taken by a concurrent claimant: try the next slot. Any other error
      // is a real failure -- fail closed (no invite written) rather than
      // guessing that quota remains.
      if (!isUniqueViolation(error)) throw error
    }
  }
  return null
}

/**
 * Atomic invite-quota claim (AFC-516, ADR-0011) -- the AUTHORITATIVE verdict.
 *
 * Protocol: INSERT day slots 0..daily-1 until one succeeds (a unique
 * violation means a concurrent claimant won that slot, so try the next);
 * then INSERT week slots 0..weekly-1 the same way. If the week claim fails,
 * the claimed day slot is released and `{ allowed: false }` is returned. On
 * success the caller writes the invite, and on invite-write failure MUST
 * call `release()` so no quota leaks on the handled path.
 *
 * Correctness rests on the UNIQUE (inviter_user, period, period_start,
 * slot_no), not on timing: concurrent writers serialize on the index, so
 * exactly D day-winners and W week-winners exist regardless of interleaving.
 * Crash orphans (claim succeeds, process dies before the invite write or the
 * release) waste quota -- the fail-safe direction: they block more, never
 * queue past the limit -- so there is deliberately no sweeper.
 *
 * Zero-limit edge: `daily: 0` (or `weekly: 0`) claims nothing, so the claim
 * is not allowed. The suppressed (STOP) path never calls this function.
 */
export async function claimInviteQuota(
  event: H3Event,
  scope: PortalScope,
  inviterUserId: string,
  limits: InviteQuotaLimits,
  now: Date = new Date(),
): Promise<InviteQuotaClaim> {
  const release = async (ids: Array<string | null>): Promise<void> => {
    for (const id of ids) {
      if (id === null) continue
      try {
        await deleteItem(event, scope, 'invite_quota_slots', id)
      } catch {
        // Best-effort: a failed release wastes one slot (fail-safe), it must
        // never turn a successful claim into a 500.
      }
    }
  }

  if (!Number.isInteger(limits.daily) || limits.daily <= 0) return { allowed: false }
  if (!Number.isInteger(limits.weekly) || limits.weekly <= 0) return { allowed: false }

  const daySlot = await claimQuotaSlot(
    event,
    scope,
    inviterUserId,
    'day',
    lagosDayKey(now),
    limits.daily,
  )
  if (daySlot === null) return { allowed: false }

  let weekSlot: string | null
  try {
    weekSlot = await claimQuotaSlot(
      event,
      scope,
      inviterUserId,
      'week',
      lagosWeekMonday(now),
      limits.weekly,
    )
  } catch (error) {
    await release([daySlot])
    throw error
  }
  if (weekSlot === null) {
    await release([daySlot])
    return { allowed: false }
  }

  return {
    allowed: true,
    release: () => release([daySlot, weekSlot]),
  }
}
