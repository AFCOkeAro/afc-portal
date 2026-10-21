import {
  findScopedItem,
  getPortalScope,
  listItems,
  requireCan,
  stripHidden,
  throwStoreUnavailable,
  visibleFields,
} from '../../utils/portal'

const FIELDS = [
  'id',
  'visitor',
  'branch',
  'contact_at',
  'contact_channel',
  'outcome',
  'notes',
  'welfare_case',
  'next_step',
  'next_follow_up_at',
  'logged_by',
  'communication',
]

export default defineEventHandler(async (event) => {
  const scope = await getPortalScope(event)
  requireCan(scope, 'visitor_follow_ups', 'read')

  const query = getQuery(event)
  const visitorId = typeof query.visitor === 'string' ? query.visitor : null
  if (!visitorId) {
    throw createError({
      statusCode: 400,
      statusMessage: 'A visitor id is required',
      data: { code: 'validation_error' },
    })
  }
  // AFC-583: the visitor scoping read + the outcome-log read hit the 0025
  // register and the 0008 log table — map an unreadable store to the named
  // error, never a bare 500. Deliberate 4xx (scope 404s, validation) pass through.
  let result: { data: Record<string, unknown>[] }
  try {
    // The visitor read scopes the timeline: no visitor in scope, no timeline.
    await findScopedItem(event, scope, 'visitors', visitorId, { fields: ['id'] })

    result = await listItems<Record<string, unknown>>(
      event,
      scope,
      'visitor_follow_ups',
      {
        filter: { visitor: { _eq: visitorId } },
        fields: visibleFields(scope, 'visitor_follow_ups', FIELDS),
        sort: '-contact_at',
        limit: -1,
      },
    )
  } catch (error) {
    if ((error as { statusCode?: number })?.statusCode) throw error
    throwStoreUnavailable(error, 'visitor_store', '0025')
  }
  return {
    data: result.data.map((row) => ({
      ...stripHidden(scope, 'visitor_follow_ups', row),
      id: String(row.id),
    })),
  }
})
