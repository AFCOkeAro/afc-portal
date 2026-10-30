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
const FIELDS = [
  'id',
  'title',
  'source_type',
  'kind',
  'url',
  'file_id',
  'session_id',
].join(',')

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
  const query = getQuery(event)
  const session = typeof query.session === 'string' ? query.session : ''

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
          ...(session === '' ? {} : { session_id: { _eq: session } }),
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
  // Session names for the handout shelf. Best-effort: without the
  // sessions read the ids still serve, just unnamed.
  const sessionIds = [
    ...new Set(
      rows.map((row) => row.session_id).filter((v) => typeof v === 'string' && v !== ''),
    ),
  ]
  let sessionNames = new Map<string, string>()
  if (sessionIds.length > 0) {
    const sessions = await directusFetch<{ data: Array<Record<string, unknown>> }>(
      event,
      '/items/attendance_sessions',
      {
        method: 'GET',
        accessToken: publicToken,
        query: {
          filter: { id: { _in: sessionIds } },
          fields: 'id,session_name',
          limit: 100,
        },
      },
    )
      .then((response) => response.data ?? [])
      .catch(() => [] as Array<Record<string, unknown>>)
    sessionNames = new Map(
      sessions.map((row) => [String(row.id), String(row.session_name ?? 'Session')]),
    )
  }
  return {
    data: rows.map((row: Record<string, unknown>) => ({
      id: String(row.id),
      title: String(row.title ?? 'Resource'),
      kind: String(row.kind ?? 'other'),
      source_type: String(row.source_type ?? 'link'),
      url: row.source_type === 'link' && row.url ? String(row.url) : null,
      file_id: row.source_type === 'upload' && row.file_id ? String(row.file_id) : null,
      session_id: typeof row.session_id === 'string' ? row.session_id : null,
      session_name:
        typeof row.session_id === 'string' && row.session_id !== ''
          ? (sessionNames.get(row.session_id) ?? 'Session')
          : null,
    })),
  }
})
