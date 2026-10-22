import { MARRIAGE_FLOW_INDEX, marriageCaseAnnounceSchema } from '@afc/shared'
import {
  assertUuidParam,
  createItem,
  findScopedItem,
  getPortalScope,
  listItems,
  requireCan,
  scopeFilter,
  scopeZoneIds,
  throwValidation,
} from '../../../utils/portal'
import { officeZoneScope, writeOfficeAudit } from '../../../utils/office'

const ANNOUNCE_TRAIL_PREFIX = 'Announcements written: 3 Sundays + wedding calendar entry'

/** The three Sundays strictly before the wedding, oldest first. */
function defaultSundays(weddingDate: string): string[] {
  const out: string[] = []
  const cursor = new Date(`${weddingDate}T00:00:00Z`)
  cursor.setUTCDate(cursor.getUTCDate() - 1)
  while (out.length < 3) {
    if (cursor.getUTCDay() === 0) out.unshift(cursor.toISOString().slice(0, 10))
    cursor.setUTCDate(cursor.getUTCDate() - 1)
  }
  return out
}

/**
 * POST /api/marriage-cases/:id/announce — 3-Sunday announcements + calendar
 * (AFC-679 phase D).
 *
 * - Gate: the case must sit at `announcements_calendar` or beyond. Arrival
 *   there passes through the transition route, which refuses any skip over
 *   `attire_check` -- so reaching this floor IS the passed attire-check
 *   gate. Running early returns {code: validation_error, fields: {stage}}.
 * - Writes one `scheduled` announcement per Sunday (default: the three
 *   Sundays before the wedding) across the named branches -- the case
 *   branch by default, plus any in-scope branch the caller names for the
 *   other family's side. Non-area callers naming an out-of-scope branch
 *   get `branch_out_of_scope`.
 * - Writes the wedding (and rehearsal, where dated) to the calendar as
 *   `events` rows, which the unified calendar feed reads. Midday times are
 *   the stated default; the exact hour is fixed at the rehearsal, not here.
 * - Runs once per case: a repeat returns `already_announced`, pinned by the
 *   trail row the first run wrote. A mid-run store failure returns 503
 *   with the partial ids so the caller reconciles before retrying (the
 *   trail row is written last, so only a completed run blocks a retry).
 */
export default defineEventHandler(async (event) => {
  const scope = await getPortalScope(event)
  requireCan(scope, 'marriage_cases', 'update')
  requireCan(scope, 'announcements', 'create')
  requireCan(scope, 'events', 'create')

  const parsed = marriageCaseAnnounceSchema.safeParse(await readBody(event))
  if (!parsed.success) throwValidation(parsed.error)
  const form = parsed.data

  const id = assertUuidParam(
    String(getRouterParam(event, 'id')),
    'case',
    'invalid_case_id',
  )
  const row = await findScopedItem<Record<string, unknown>>(
    event,
    scope,
    'marriage_cases',
    id,
    { scope: { ...scopeFilter(scope), ...officeZoneScope(scope) } },
  )
  const stage = String(row.stage)

  if (['halted', 'transferred_out', 'reported'].includes(stage)) {
    throw createError({
      statusCode: 400,
      statusMessage: 'A closed case cannot announce',
      data: { code: 'validation_error', fields: { stage: 'This file is closed' } },
    })
  }
  const stageIndex = MARRIAGE_FLOW_INDEX[stage] ?? -1
  if (stageIndex < (MARRIAGE_FLOW_INDEX['announcements_calendar'] ?? 0)) {
    throw createError({
      statusCode: 400,
      statusMessage: 'The attire check must pass before announcements run',
      data: {
        code: 'validation_error',
        fields: { stage: 'Pass the attire check first' },
      },
    })
  }

  const weddingDate = row.wedding_date ? String(row.wedding_date).slice(0, 10) : null
  if (!weddingDate) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Fix the wedding date before announcements run',
      data: {
        code: 'validation_error',
        fields: { wedding_date: 'Set the wedding date first' },
      },
    })
  }
  const rehearsalDate = row.rehearsal_date
    ? String(row.rehearsal_date).slice(0, 10)
    : null

  const sundays = form.publish_sundays ?? defaultSundays(weddingDate)
  if (sundays.length !== 3) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Name exactly three Sundays',
      data: {
        code: 'validation_error',
        fields: { publish_sundays: 'Three Sundays are announced' },
      },
    })
  }
  for (const day of sundays) {
    const date = new Date(`${day}T00:00:00Z`)
    if (Number.isNaN(date.getTime()) || date.getUTCDay() !== 0 || day >= weddingDate) {
      throw createError({
        statusCode: 400,
        statusMessage: 'Each announcement day must be a Sunday before the wedding',
        data: {
          code: 'validation_error',
          fields: { publish_sundays: `${day} is not a pre-wedding Sunday` },
        },
      })
    }
  }

  const caseBranch = String(row.branch)
  const branches = form.branches ?? [caseBranch]
  if (branches.length === 0) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Name at least one branch',
      data: { code: 'validation_error', fields: { branches: 'Choose a branch' } },
    })
  }
  if (!scope.isArea) {
    for (const branch of branches) {
      if (!scope.branchIds.includes(branch)) {
        throw createError({
          statusCode: 403,
          statusMessage: 'That branch is outside your scope',
          data: { code: 'branch_out_of_scope' },
        })
      }
    }
  }

  const prior = await listItems<Record<string, unknown>>(
    event,
    scope,
    'marriage_case_events',
    {
      filter: {
        marriage_case: { _eq: id },
        event_type: { _eq: 'note' },
        detail: { _contains: ANNOUNCE_TRAIL_PREFIX },
      },
      fields: ['id'],
      limit: 1,
    },
  )
  if (prior.data.length > 0) {
    throw createError({
      statusCode: 400,
      statusMessage: 'The announcements already ran for the case',
      data: { code: 'already_announced' },
    })
  }

  const zones = await scopeZoneIds(event, scope)
  const zone = row.zone ? String(row.zone) : (zones[0] ?? null)
  const now = new Date().toISOString()
  const announcementIds: string[] = []
  const eventIds: string[] = []

  try {
    let week = 0
    for (const day of [...sundays].sort()) {
      week += 1
      for (const branch of branches) {
        const created = await createItem<Record<string, unknown>>(
          event,
          scope,
          'announcements',
          {
            title: `Marriage announcement — Sunday ${day} (${week} of 3)`,
            body: `Sunday announcement ${week} of 3 ahead of the wedding on ${weddingDate}.`,
            publish_from: `${day}T09:00:00Z`,
            publish_to: `${day}T21:00:00Z`,
            channels: ['pulpit'],
            audience: { marriage_case: id, week },
            status: 'scheduled',
            branch,
            zone,
            created_by: scope.session.user.id,
            approved_by: null,
            created_at: now,
            updated_at: now,
          },
        )
        announcementIds.push(String(created.id))
      }
    }
  } catch (error) {
    if (error && typeof error === 'object' && 'statusCode' in error) throw error
    throw createError({
      statusCode: 503,
      statusMessage: 'The announcement store is unavailable',
      data: {
        code: 'announcement_store_unavailable',
        cause: String(error),
        partial: { announcements: announcementIds, events: eventIds },
      },
    })
  }

  try {
    const wedding = await createItem<Record<string, unknown>>(event, scope, 'events', {
      title: 'Wedding service',
      summary: `Wedding on ${weddingDate}`,
      description: null,
      event_type: 'service',
      branch: caseBranch,
      start_at: `${weddingDate}T10:00:00Z`,
      end_at: `${weddingDate}T13:00:00Z`,
      location: null,
      address: null,
      capacity: null,
      waitlist_enabled: false,
      registration_opens_at: null,
      registration_closes_at: null,
      registration_open: false,
      visibility: 'branch',
      status: 'published',
    })
    eventIds.push(String(wedding.id))
    if (rehearsalDate) {
      const rehearsal = await createItem<Record<string, unknown>>(
        event,
        scope,
        'events',
        {
          title: 'Wedding rehearsal',
          summary: `Rehearsal on ${rehearsalDate}`,
          description: null,
          event_type: 'service',
          branch: caseBranch,
          start_at: `${rehearsalDate}T10:00:00Z`,
          end_at: `${rehearsalDate}T12:00:00Z`,
          location: null,
          address: null,
          capacity: null,
          waitlist_enabled: false,
          registration_opens_at: null,
          registration_closes_at: null,
          registration_open: false,
          visibility: 'branch',
          status: 'published',
        },
      )
      eventIds.push(String(rehearsal.id))
    }
  } catch (error) {
    if (error && typeof error === 'object' && 'statusCode' in error) throw error
    throw createError({
      statusCode: 503,
      statusMessage: 'The calendar store is unavailable',
      data: {
        code: 'calendar_store_unavailable',
        cause: String(error),
        partial: { announcements: announcementIds, events: eventIds },
      },
    })
  }

  await writeOfficeAudit(event, scope, 'marriage_case_events', {
    marriage_case: id,
    from_stage: stage,
    to_stage: stage,
    event_type: 'note',
    detail: `${ANNOUNCE_TRAIL_PREFIX} (${sundays.join(', ')})`,
    actor_user: scope.session.user.id,
    created_at: now,
  })

  return { data: { announcements: announcementIds, events: eventIds } }
})
