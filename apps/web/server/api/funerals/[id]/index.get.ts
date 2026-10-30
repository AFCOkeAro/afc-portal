import {
  findScopedItem,
  getPortalScope,
  requireCan,
  throwStoreUnavailable,
} from '../../../utils/portal'

const FIELDS = [
  'id',
  'branch',
  'zone',
  'deceased_person',
  'deceased_name',
  'stage',
  'death_certificate_file',
  'consent_letter_file',
  'songs',
  'programme_approved_by',
  'programme_approved_at',
  'service_of_songs_date',
  'funeral_date',
  'service_of_songs_attendance',
  'funeral_attendance',
  'notes',
  'created_by',
  'created_at',
]

/**
 * GET /api/funerals/:id — scoped funeral detail (AFC-884). Person name
 * resolves in the same call so the page never N+1s the directory.
 */
export default defineEventHandler(async (event) => {
  const scope = await getPortalScope(event)
  requireCan(scope, 'funeral_cases', 'read')

  const id = getRouterParam(event, 'id')
  if (!id)
    throw createError({ statusCode: 400, statusMessage: 'A funeral id is required' })
  try {
    const row = await findScopedItem<Record<string, unknown>>(
      event,
      scope,
      'funeral_cases',
      id,
      { fields: FIELDS },
    )
    let personName: string | null = null
    if (typeof row.deceased_person === 'string' && row.deceased_person !== '') {
      const person = await findScopedItem<Record<string, unknown>>(
        event,
        scope,
        'people',
        String(row.deceased_person),
        { fields: ['first_name', 'last_name', 'preferred_name'] },
      ).catch(() => null)
      if (person) {
        personName = String(
          person.preferred_name ||
            [person.first_name, person.last_name].filter(Boolean).join(' ') ||
            'Linked person',
        )
      }
    }
    return {
      data: {
        ...row,
        deceased_display:
          personName ??
          (typeof row.deceased_name === 'string' && row.deceased_name !== ''
            ? row.deceased_name
            : 'Unnamed'),
      },
    }
  } catch (error) {
    if ((error as { statusCode?: number })?.statusCode) throw error
    throwStoreUnavailable(error, 'funeral_store', '0062')
  }
})
