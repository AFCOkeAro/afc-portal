import {
  getPortalScope,
  listItems,
  requireCan,
  scopeFilter,
  throwStoreUnavailable,
} from '../../utils/portal'

const FIELDS = [
  'id',
  'branch',
  'deceased_person',
  'deceased_name',
  'stage',
  'service_of_songs_date',
  'funeral_date',
  'created_at',
]

/**
 * GET /api/funerals — scoped list of funeral cases (AFC-884). Person
 * names resolve in one batched read; contact details never leave here.
 */
export default defineEventHandler(async (event) => {
  const scope = await getPortalScope(event)
  requireCan(scope, 'funeral_cases', 'read')

  try {
    const result = await listItems<Record<string, unknown>>(
      event,
      scope,
      'funeral_cases',
      {
        filter: scopeFilter(scope),
        fields: FIELDS,
        sort: '-created_at',
        page: 1,
        limit: 100,
      },
    )
    const personIds = [
      ...new Set(
        result.data
          .map((row) => row.deceased_person)
          .filter((v): v is string => typeof v === 'string' && v !== ''),
      ),
    ]
    let names = new Map<string, string>()
    if (personIds.length > 0) {
      const people = await listItems<Record<string, unknown>>(event, scope, 'people', {
        filter: { id: { _in: personIds } },
        fields: ['id', 'first_name', 'last_name', 'preferred_name'],
        limit: personIds.length,
      }).catch(() => ({ data: [] as Array<Record<string, unknown>> }))
      names = new Map(
        people.data.map((row) => [
          String(row.id),
          String(
            row.preferred_name ||
              [row.first_name, row.last_name].filter(Boolean).join(' ') ||
              'Someone',
          ),
        ]),
      )
    }
    return {
      data: result.data.map((row) => ({
        ...row,
        deceased_display:
          typeof row.deceased_person === 'string' && row.deceased_person !== ''
            ? (names.get(row.deceased_person) ?? 'Linked person')
            : typeof row.deceased_name === 'string' && row.deceased_name !== ''
              ? row.deceased_name
              : 'Unnamed',
      })),
    }
  } catch (error) {
    if ((error as { statusCode?: number })?.statusCode) throw error
    throwStoreUnavailable(error, 'funeral_store', '0062')
  }
})
