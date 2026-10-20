import {
  findScopedItem,
  getPortalScope,
  listItems,
  requireCan,
  stripHidden,
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
  // The visitor read scopes the timeline: no visitor in scope, no timeline.
  await findScopedItem(event, scope, 'visitors', visitorId, { fields: ['id'] })

  const result = await listItems<Record<string, unknown>>(
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
  return {
    data: result.data.map((row) => ({
      ...stripHidden(scope, 'visitor_follow_ups', row),
      id: String(row.id),
    })),
  }
})
