import {
  findScopedItem,
  getPortalScope,
  listItems,
  requireCan,
} from '../../../../utils/portal'
import { directusBaseUrl } from '../../../../utils/directus'

/**
 * GET /api/events/:id/resources/file?file= — proxy one resource file
 * (AFC-844, receipt precedent). The file id must belong to a resource row
 * on this event — ids are not guessable across events. Streams bytes with
 * the stored content type; never redirects to a bare Directus URL.
 */
export default defineEventHandler(async (event) => {
  const scope = await getPortalScope(event)
  requireCan(scope, 'event_resources', 'read')

  const id = getRouterParam(event, 'id')
  if (!id)
    throw createError({ statusCode: 400, statusMessage: 'An event id is required' })
  const query = getQuery(event)
  const file = typeof query.file === 'string' ? query.file : ''
  if (!file)
    throw createError({ statusCode: 400, statusMessage: 'A file id is required' })

  await findScopedItem(event, scope, 'events', id, { fields: ['id'] })
  const found = await listItems<{ id: string }>(event, scope, 'event_resources', {
    filter: { event: { _eq: id }, file_id: { _eq: file } },
    fields: ['id'],
    limit: 1,
  }).catch(() => ({ data: [] as Array<{ id: string }> }))
  if (found.data.length === 0) {
    throw createError({
      statusCode: 404,
      statusMessage: 'That file was not found on this event',
      data: { code: 'not_found' },
    })
  }

  const upstream = await fetch(`${directusBaseUrl(event)}/assets/${file}`, {
    headers: scope.token ? { Authorization: `Bearer ${scope.token}` } : {},
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
