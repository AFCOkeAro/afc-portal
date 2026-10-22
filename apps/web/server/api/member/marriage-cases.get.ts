import { MARRIAGE_FLOW_INDEX, MARRIAGE_FLOW_STAGES } from '@afc/shared'
import { directusFetch } from '../../utils/directus'
import { requireSession } from '../../utils/session'
import { isMemberSession } from '../../utils/event-invites'
import type { PortalScope } from '../../utils/portal'

/**
 * GET /api/member/marriage-cases — couple progress in the member portal
 * (AFC-678 phase C).
 *
 * Member sessions only. Identity comes from the session personId, never
 * from a query parameter: a member sees only cases where they are the
 * brother or the sister (own-household R, record-level by construction --
 * no cross-read is expressible). Staff sessions get 403; this surface is
 * the couple's own progress, not a staff lookup.
 *
 * Projection is minimal: stage + position in the flow + wedding date +
 * task checklist counts. No halt reasons, no transfer destinations, no
 * staff notes.
 */
export default defineEventHandler(async (event) => {
  const { session } = await requireSession(event)
  if (!isMemberSession({ role: session.user.staffRole } as PortalScope)) {
    throw createError({
      statusCode: 403,
      statusMessage: 'This progress surface is for member sessions only',
      data: { code: 'forbidden' },
    })
  }
  const personId = session.user.personId
  if (!personId) {
    throw createError({
      statusCode: 401,
      statusMessage: 'Your login is not linked to a member record yet',
      data: { code: 'member_unlinked' },
    })
  }

  let cases: Array<Record<string, unknown>> = []
  try {
    const response = await directusFetch<{ data: Array<Record<string, unknown>> }>(
      event,
      '/items/marriage_cases',
      {
        query: {
          fields: 'id,stage,wedding_date,rehearsal_date,engagement_date,updated_at',
          limit: -1,
          filter: {
            _or: [
              { brother_person: { _eq: personId } },
              { sister_person: { _eq: personId } },
            ],
          },
        },
      },
    )
    cases = response.data
  } catch (error) {
    throw createError({
      statusCode: 503,
      statusMessage: 'The marriage pipeline is unavailable (migration 0035 not applied?)',
      data: { code: 'pending_migration_0035', cause: String(error) },
    })
  }

  const totalStages = MARRIAGE_FLOW_STAGES.length
  const data = []
  for (const row of cases) {
    const stage = String(row.stage)
    if (['halted', 'transferred_out'].includes(stage)) continue
    const stageIndex = MARRIAGE_FLOW_INDEX[stage] ?? 0
    let tasksTotal = 0
    let tasksDone = 0
    try {
      const tasks = await directusFetch<{ data: Array<{ status: string }> }>(
        event,
        '/items/tasks',
        {
          query: {
            fields: 'status',
            limit: -1,
            filter: { related_id: { _eq: String(row.id) } },
          },
        },
      )
      tasksTotal = tasks.data.length
      tasksDone = tasks.data.filter(
        (t) => t.status === 'done' || t.status === 'cancelled',
      ).length
    } catch {
      // Checklist counts are best-effort; the stage itself stands.
    }
    data.push({
      id: String(row.id),
      stage,
      stageIndex,
      totalStages,
      wedding_date: (row.wedding_date as string | null) ?? null,
      rehearsal_date: (row.rehearsal_date as string | null) ?? null,
      engagement_date: (row.engagement_date as string | null) ?? null,
      tasksTotal,
      tasksDone,
    })
  }

  return { data }
})
