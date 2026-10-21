import {
  csvResponse,
  getPortalScope,
  requireCan,
  throwStoreUnavailable,
} from '../../utils/portal'
import { buildFunnelForScope } from '../../utils/visitor-journey'

export default defineEventHandler(async (event) => {
  const scope = await getPortalScope(event)
  // Permission-scoped export: same reader grant as the funnel page, same
  // branch scope folded into the rows. Hidden fields never reach a CSV --
  // the funnel carries no contact detail by construction.
  requireCan(scope, 'visitors', 'read')
  // AFC-583: the funnel folds 0025 register rows — map an unreadable store
  // to the named error, never a bare 500. Deliberate 4xx pass through untouched.
  let funnel: Awaited<ReturnType<typeof buildFunnelForScope>>
  try {
    funnel = await buildFunnelForScope(event, scope)
  } catch (error) {
    if ((error as { statusCode?: number })?.statusCode) throw error
    throwStoreUnavailable(error, 'visitor_store', '0025')
  }

  const stageRows: string[][] = [
    ['stage', 'sequence', 'visitors', 'new_this_week', 'avg_days_in_stage', 'overdue'],
    ...funnel.stages.map((stage) => [
      stage.key,
      String(stage.sequence),
      String(stage.visitors),
      String(stage.newThisWeek),
      stage.avgDaysInStage === null ? '' : String(stage.avgDaysInStage),
      String(stage.overdue),
    ]),
  ]
  const officerRows: string[][] = [
    [],
    ['officer', 'due_today', 'overdue', 'unassigned_over_3d'],
    ...funnel.officers.map((row) => [
      row.officer ?? 'Unassigned',
      String(row.dueToday),
      String(row.overdue),
      String(row.unassignedOver3d),
    ]),
  ]
  return csvResponse(event, 'visitor-funnel.csv', [...stageRows, ...officerRows])
})
