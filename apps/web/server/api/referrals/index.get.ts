import { getPortalScope, listItems, requireCan, scopeFilter } from '../../utils/portal'
import { logScopedQuery } from '../../utils/office'

/** GET /api/referrals?event= — scoped invite-a-friend referrals (US-E2 AC1). */
export default defineEventHandler(async (event) => {
  const scope = await getPortalScope(event)
  requireCan(scope, 'event_referrals', 'read')

  const query = getQuery(event)
  const forEvent = typeof query.event === 'string' ? query.event : undefined
  logScopedQuery(scope, 'referrals.list', { event: forEvent ?? 'all' })

  const { data, meta } = await listItems<Record<string, unknown>>(
    event,
    scope,
    'event_referrals',
    {
      filter: {
        ...scopeFilter(scope, 'branch'),
        ...(forEvent ? { event: { _eq: forEvent } } : {}),
      },
      sort: '-invite_date',
      limit: 100,
    },
  )
  return { data, meta }
})
