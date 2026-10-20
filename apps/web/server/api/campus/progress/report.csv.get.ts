import { progressToCsv } from '../../../utils/campus'
import { collectCampusProgress } from '../../../utils/campus-report'
import { csvResponse, getPortalScope, requireCan } from '../../../utils/portal'

/**
 * GET /api/campus/progress/report.csv?programme=&campus_student=
 *
 * Progress CSV for the coordinator (AFC-484, US-C2 AC3). Reads the same
 * shared collector as the list route over the same scoped query — the two
 * cannot drift. Scores are included: the export is coordinator/
 * branch-admin-own scoped by the collector, matching the §11.1 read rule.
 */
export default defineEventHandler(async (event) => {
  const scope = await getPortalScope(event)
  requireCan(scope, 'coaching_progress', 'read')

  const query = getQuery(event)
  const text = (name: string): string | null => {
    const value = query[name]
    return typeof value === 'string' && value.length > 0 ? value : null
  }

  const { rows } = await collectCampusProgress(event, scope, {
    programme: text('programme'),
    student: text('campus_student') ?? text('student'),
  })

  return csvResponse(event, 'campus-progress.csv', progressToCsv(rows))
})
