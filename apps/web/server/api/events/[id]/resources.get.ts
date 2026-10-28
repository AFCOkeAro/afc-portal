import {
  findScopedItem,
  getPortalScope,
  listItems,
  mergeFilters,
  requireCan,
  scopeFilter,
  throwStoreUnavailable,
} from '../../../utils/portal'

const FIELDS = [
  'id',
  'event',
  'speaker',
  'branch',
  'zone',
  'title',
  'source_type',
  'kind',
  'url',
  'file_id',
  'status',
  'decided_by',
  'decided_at',
  'created_by',
  'created_at',
]

/**
 * GET /api/events/:id/resources — the event library (AFC-844).
 *
 * Fail-closed display rule: without an explicit status the route answers
 * approved rows only (the Resources page). The pending queue needs
 * `?status=pending` AND the update grant — unapproved titles stay out of
 * the default response.
 */
export default defineEventHandler(async (event) => {
  const scope = await getPortalScope(event)
  requireCan(scope, 'event_resources', 'read')

  const id = getRouterParam(event, 'id')
  if (!id)
    throw createError({ statusCode: 400, statusMessage: 'An event id is required' })
  const query = getQuery(event)
  const status = typeof query.status === 'string' ? query.status : ''
  try {
    await findScopedItem(event, scope, 'events', id, { fields: ['id'] })
    if (status !== '' && status !== 'approved') {
      requireCan(scope, 'event_resources', 'update')
    }
    const result = await listItems<Record<string, unknown>>(
      event,
      scope,
      'event_resources',
      {
        filter: mergeFilters(
          { event: { _eq: id } },
          status === '' ? { status: { _eq: 'approved' } } : { status: { _eq: status } },
          scopeFilter(scope),
        ),
        fields: FIELDS,
        sort: 'created_at',
        limit: 100,
      },
    )
    const speakerIds = [...new Set(result.data.map((row) => row.speaker).filter(Boolean))]
    let names = new Map<string, string>()
    if (speakerIds.length > 0) {
      const speakers = await listItems<Record<string, unknown>>(
        event,
        scope,
        'event_speakers',
        {
          filter: { id: { _in: speakerIds } },
          fields: ['id', 'person', 'external_name'],
          limit: 100,
        },
      ).catch(() => ({ data: [] as Record<string, unknown>[] }))
      const personIds = [
        ...new Set(speakers.data.map((row) => row.person).filter(Boolean)),
      ]
      let personNames = new Map<string, string>()
      if (personIds.length > 0) {
        const people = await listItems<Record<string, unknown>>(event, scope, 'people', {
          filter: { id: { _in: personIds } },
          fields: ['id', 'first_name', 'last_name', 'preferred_name'],
          limit: 100,
        }).catch(() => ({ data: [] as Record<string, unknown>[] }))
        personNames = new Map(
          people.data.map((row: Record<string, unknown>) => {
            const full =
              `${String(row.first_name ?? '').trim()} ${String(row.last_name ?? '').trim()}`.trim()
            return [
              String(row.id),
              String(row.preferred_name ?? '').trim() || full || 'Unnamed member',
            ]
          }),
        )
      }
      names = new Map(
        speakers.data.map((row: Record<string, unknown>) => [
          String(row.id),
          row.person
            ? (personNames.get(String(row.person)) ?? 'Unknown')
            : String(row.external_name ?? '') || 'Guest',
        ]),
      )
    }
    return {
      data: result.data.map((row) => ({
        ...row,
        speaker_name: row.speaker ? (names.get(String(row.speaker)) ?? 'Unknown') : null,
      })),
    }
  } catch (error) {
    if ((error as { statusCode?: number })?.statusCode) throw error
    throwStoreUnavailable(error, 'resource_store', '0054')
  }
})
