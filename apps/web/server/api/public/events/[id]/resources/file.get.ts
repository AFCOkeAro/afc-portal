import { directusFetch } from '../../../../../utils/directus'
import { directusBaseUrl } from '../../../../../utils/directus'

/**
 * GET /api/public/events/:id/resources/file?file= — proxy one approved
 * resource file for the landing page (AFC-828 phase 3, receipt
 * precedent). Three gates, all server-side: the file id must belong to
 * an *approved* resource on this event, and the event itself must be
 * visibility=public AND status=published. Streams bytes with the stored
 * content type; never redirects to a bare Directus URL.
 */
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
  const file = typeof query.file === 'string' ? query.file : ''
  if (!file)
    throw createError({ statusCode: 400, statusMessage: 'A file id is required' })

  const rows = await directusFetch<{ data: Array<unknown> }>(
    event,
    '/items/event_resources',
    {
      method: 'GET',
      accessToken: publicToken,
      query: {
        filter: {
          event: { _eq: id },
          file_id: { _eq: file },
          status: { _eq: 'approved' },
        },
        fields: 'id',
        limit: 1,
      },
    },
  )
    .then((response) => response.data ?? [])
    .catch(() => [])
  if (rows.length === 0) {
    throw createError({
      statusCode: 404,
      statusMessage: 'That file was not found for this event',
      data: { code: 'not_found' },
    })
  }
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
      statusMessage: 'That file was not found for this event',
      data: { code: 'not_found' },
    })
  }

  const upstream = await fetch(`${directusBaseUrl(event)}/assets/${file}`, {
    headers: { Authorization: `Bearer ${publicToken}` },
  }).catch(() => null)
  if (!upstream || !upstream.ok || !upstream.body) {
    throw createError({
      statusCode: 503,
      statusMessage: 'The file store is unavailable',
      data: { code: 'resource_file_unavailable' },
    })
  }
  const contentType = upstream.headers.get('content-type') ?? 'application/octet-stream'
  return new Response(upstream.body, {
    headers: { 'content-type': contentType },
  })
})
