import { getPortalScope } from '../../utils/portal'
import { buildFunnelForScope } from '../../utils/visitor-journey'
import { csvResponse, requireCan } from '../../utils/portal'

export default defineEventHandler(async (event) => {
  const scope = await getPortalScope(event)
  // Permission-scoped export: same reader grant as the funnel page, same
  // branch scope folded into the rows. Hidden fields never reach a CSV --
  // the funnel carries no contact detail by construction.
  requireCan(scope, 'visitors', 'read')
  const funnel = await buildFunnelForScope(event, scope)

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
