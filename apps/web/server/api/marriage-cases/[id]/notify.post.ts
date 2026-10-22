import {
  MARRIAGE_FLOW_INDEX,
  MARRIAGE_NOTIFY_STAGE_FLOOR,
  marriageCaseNotifySchema,
} from '@afc/shared'
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

const CLOSED_STAGES = ['halted', 'transferred_out', 'reported']

const TRAIL_PREFIX = {
  music_director: 'Music Director notified on portal',
  ministers: 'Ministers mailed ahead',
} as const

/**
 * POST /api/marriage-cases/:id/notify — phase-D notifications (AFC-679).
 *
 * - `music_director`: once the case reaches `wedding_info`, a portal task
 *   names the Music Director (the director sees it at sign-in, same posture
 *   as the auto-generated pipeline tasks). No user lookup: assignment stays
 *   with the acting staff member, the title carries the addressee.
 * - `ministers`: once the case reaches `ministers_mail`, a draft
 *   announcement with channels ['mail'] and audience { group: 'ministers' }
 *   is filed. The route creates the draft only -- approval, send and the
 *   consent/suppression checks stay with the existing communications
 *   machinery (delivery log + opt-out suppressions), which this slice does
 *   not fork.
 *
 * Each channel notifies once per case (repeat calls return
 * `already_notified`, pinned by the trail row the first call wrote).
 */
export default defineEventHandler(async (event) => {
  const scope = await getPortalScope(event)
  requireCan(scope, 'marriage_cases', 'update')

  const parsed = marriageCaseNotifySchema.safeParse(await readBody(event))
  if (!parsed.success) throwValidation(parsed.error)
  const { channel, note } = parsed.data

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

  if (CLOSED_STAGES.includes(stage)) {
    throw createError({
      statusCode: 400,
      statusMessage: 'A closed case cannot notify again',
      data: { code: 'validation_error', fields: { channel: 'This file is closed' } },
    })
  }

  const floor = MARRIAGE_NOTIFY_STAGE_FLOOR[channel]
  const stageIndex = MARRIAGE_FLOW_INDEX[stage] ?? -1
  if (stageIndex < (MARRIAGE_FLOW_INDEX[floor] ?? 0)) {
    throw createError({
      statusCode: 400,
      statusMessage: `The ${channel === 'music_director' ? 'Music Director' : 'ministers'} notice runs at ${floor}, not ${stage}`,
      data: {
        code: 'validation_error',
        fields: { channel: `Reach ${floor} first` },
      },
    })
  }

  const prior = await listItems<Record<string, unknown>>(
    event,
    scope,
    'marriage_case_events',
    {
      filter: {
        marriage_case: { _eq: id },
        event_type: { _eq: 'note' },
        detail: { _contains: TRAIL_PREFIX[channel] },
      },
      fields: ['id'],
      limit: 1,
    },
  )
  if (prior.data.length > 0) {
    throw createError({
      statusCode: 400,
      statusMessage: 'This notice already ran for the case',
      data: { code: 'already_notified', fields: { channel: 'Sent already' } },
    })
  }

  const branch = String(row.branch)
  const zone = row.zone
    ? String(row.zone)
    : ((await scopeZoneIds(event, scope))[0] ?? null)
  const now = new Date().toISOString()
  const weddingDate = row.wedding_date ? String(row.wedding_date) : null

  if (channel === 'music_director') {
    requireCan(scope, 'tasks', 'create')
    const due = weddingDate
      ? new Date(Date.parse(weddingDate) - 14 * 24 * 60 * 60 * 1000)
          .toISOString()
          .slice(0, 10)
      : new Date(Date.parse(now) + 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
    let task: Record<string, unknown>
    try {
      task = await createItem<Record<string, unknown>>(event, scope, 'tasks', {
        title: 'Music selection with the Music Director',
        description: `Notify the Music Director: wedding ${weddingDate ?? 'date not fixed yet'}${note ? ` — ${note}` : ''}`,
        assignee_user: scope.session.user.id,
        assignee_person: null,
        branch,
        zone,
        due_date: due,
        status: 'todo',
        priority: 'high',
        related_type: 'marriage_case',
        related_id: id,
        created_by: scope.session.user.id,
        created_at: now,
        updated_at: now,
      })
    } catch (error) {
      if (error && typeof error === 'object' && 'statusCode' in error) throw error
      throw createError({
        statusCode: 503,
        statusMessage: 'The task store is unavailable',
        data: { code: 'task_store_unavailable', cause: String(error) },
      })
    }
    await writeOfficeAudit(event, scope, 'marriage_case_events', {
      marriage_case: id,
      from_stage: stage,
      to_stage: stage,
      event_type: 'note',
      detail: `${TRAIL_PREFIX[channel]}${note ? `: ${note}` : ''}`,
      actor_user: scope.session.user.id,
      created_at: now,
    })
    return { data: { channel, task: String(task.id) } }
  }

  requireCan(scope, 'announcements', 'create')
  let announcement: Record<string, unknown>
  try {
    announcement = await createItem<Record<string, unknown>>(
      event,
      scope,
      'announcements',
      {
        title: `Ministers mail ahead — wedding ${weddingDate ?? 'date not fixed yet'}`,
        body: `Mail the ministers ahead of the wedding${weddingDate ? ` on ${weddingDate}` : ''}.${note ? ` ${note}` : ''}`,
        publish_from: null,
        publish_to: null,
        channels: ['mail'],
        audience: { group: 'ministers', marriage_case: id },
        status: 'draft',
        branch,
        zone,
        created_by: scope.session.user.id,
        approved_by: null,
        created_at: now,
        updated_at: now,
      },
    )
  } catch (error) {
    if (error && typeof error === 'object' && 'statusCode' in error) throw error
    throw createError({
      statusCode: 503,
      statusMessage: 'The announcement store is unavailable',
      data: { code: 'announcement_store_unavailable', cause: String(error) },
    })
  }
  await writeOfficeAudit(event, scope, 'marriage_case_events', {
    marriage_case: id,
    from_stage: stage,
    to_stage: stage,
    event_type: 'note',
    detail: `${TRAIL_PREFIX[channel]} (draft filed; send honours consent suppressions)${note ? `: ${note}` : ''}`,
    actor_user: scope.session.user.id,
    created_at: now,
  })
  return { data: { channel, announcement: String(announcement.id) } }
})
