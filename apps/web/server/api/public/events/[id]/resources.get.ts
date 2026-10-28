import { directusFetch } from '../../../../utils/directus'

/**
 * GET /api/public/events/:id/resources — approved programme materials
 * for the landing page (AFC-828 phase 3).
 *
 * Same session-free contract as the public event route: public token
 * only, visibility=public AND status=published enforced in the query,
 * allowlisted fields, approved rows only. Speaker names are omitted —
 * resolving them would read the people directory with the public token.
 */
const FIELDS = ['id', 'title', 'source_type', 'kind', 'url', 'file_id'].join(',')

export default defineEventHandler(async (event) => {
  const config = useRuntimeConfig(event)
  const publicToken = String(config.directusPublicToken ?? '')
  if (!publicToken) {
    throw createError({
      statusCode: 503,
      statusMessage:
        'NUXT_DIRECTUS_PUBLIC_TOKEN is not configured. The public page is closed.',
      data: { code: 'event_public_unavailable' },
    })
  }
  const id = getRouterParam(event, 'id')
  if (!id)
    throw createError({ statusCode: 400, statusMessage: 'An event id is required' })

  const rows = await directusFetch<{ data: Record<string, unknown>[] }>(
    event,
    '/items/event_resources',
    {
      method: 'GET',
      accessToken: publicToken,
      query: {
        filter: {
          event: { _eq: id },
          status: { _eq: 'approved' },
        },
        fields: FIELDS,
        sort: 'created_at',
        limit: 100,
      },
    },
  )
    .then((response) => response.data ?? [])
    .catch(() => null)
  if (rows === null) {
    throw createError({
      statusCode: 503,
      statusMessage: 'The public library is unavailable',
      data: { code: 'resources_public_unavailable' },
    })
  }
  // Belt and braces: the event itself must be public + published, or a
  // non-public event's approved rows would leak through a guessed id.
  const visible = await directusFetch<{ data: Array<unknown> }>(event, '/items/events', {
    method: 'GET',
    accessToken: publicToken,
    query: {
      filter: {
        id: { _eq: id },
        visibility: { _eq: 'public' },
        status: { _eq: 'published' },
      },
      fields: 'id',
      limit: 1,
    },
  })
    .then((response) => (response.data ?? []).length > 0)
    .catch(() => false)
  if (!visible) {
    throw createError({
      statusCode: 404,
      statusMessage: 'That event was not found',
      data: { code: 'not_found' },
    })
  }
  return {
    data: rows.map((row: Record<string, unknown>) => ({
      id: String(row.id),
      title: String(row.title ?? 'Resource'),
      kind: String(row.kind ?? 'other'),
      source_type: String(row.source_type ?? 'link'),
      url: row.source_type === 'link' && row.url ? String(row.url) : null,
      file_id: row.source_type === 'upload' && row.file_id ? String(row.file_id) : null,
    })),
  }
})
