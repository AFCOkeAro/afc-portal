import type { VisitorRow } from '../../../types/portal'
import {
  branchNames,
  findScopedItem,
  getPortalScope,
  requireCan,
} from '../../utils/portal'

export default defineEventHandler(async (event): Promise<VisitorRow> => {
  const scope = await getPortalScope(event)
  requireCan(scope, 'visitors', 'read')

  const id = getRouterParam(event, 'id')
  if (!id) throw createError({ statusCode: 400, statusMessage: 'A visitor id is required' })

  const row = await findScopedItem<VisitorRow>(event, scope, 'visitors', id, {
    fields: [
      'id',
      'branch',
      'visitor_first_name',
      'visitor_last_name',
      'email',
      'phone',
      'visit_date',
      'event',
      'age_group',
      'invited_by',
      'person',
      'status',
      'follow_up_owner',
      'next_follow_up_date',
      'notes',
    ],
  })
  const names = await branchNames(event, scope)
  return {
    ...row,
    id: String(row.id),
    branch_name: row.branch ? (names.get(String(row.branch)) ?? null) : null,
    person_name: null,
  }
})
