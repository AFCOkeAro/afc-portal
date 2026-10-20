import type { BranchSummary } from '../../types/portal'
import {
  getPortalScope,
  listItems,
  mergeFilters,
  scopeFilter,
} from '../utils/portal'

export default defineEventHandler(async (event): Promise<BranchSummary[]> => {
  const scope = await getPortalScope(event)
  const result = await listItems<BranchSummary>(event, scope, 'branches', {
    filter: mergeFilters({ status: { _eq: 'active' } }, scopeFilter(scope)),
    fields: ['id', 'name', 'code', 'branch_type', 'status'],
    sort: 'sort,name',
    limit: -1,
  })
  return result.data.map((branch) => ({ ...branch, id: String(branch.id) }))
})
