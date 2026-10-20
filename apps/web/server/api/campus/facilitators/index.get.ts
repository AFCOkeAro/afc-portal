import { COACHING_FACILITATOR_FIELDS, programmeChildFilter } from '../../../utils/campus'
import {
  getPortalScope,
  listItems,
  mergeFilters,
  requireCan,
} from '../../../utils/portal'

/**
 * GET /api/campus/facilitators?programme=&call_status=
 *
 * Facilitator registrations (AFC-484, US-C1 AC2). Scope resolves through
 * the parent programme; rows carry no scope columns of their own.
 */
export default defineEventHandler(async (event) => {
  const scope = await getPortalScope(event)
  requireCan(scope, 'coaching_facilitators', 'read')

  const query = getQuery(event)
  const text = (name: string): string | null => {
    const value = query[name]
    return typeof value === 'string' && value.length > 0 ? value : null
  }

  const programme = text('programme')
  const callStatus = text('call_status')
  const page = Math.max(1, Number(query.page) || 1)
  const limit = Math.min(200, Math.max(1, Number(query.limit) || 25))

  const scopeFilter = await programmeChildFilter(event, scope)

  const result = await listItems<Record<string, unknown>>(
    event,
    scope,
    'coaching_facilitators',
    {
      filter: mergeFilters(
        scopeFilter,
        programme ? { programme: { _eq: programme } } : undefined,
        callStatus ? { call_status: { _eq: callStatus } } : undefined,
      ),
      fields: COACHING_FACILITATOR_FIELDS,
      sort: '-created_at',
      page,
      limit,
    },
  )

  return {
    data: result.data,
    meta: { total: result.meta.total, page, limit },
  }
})
