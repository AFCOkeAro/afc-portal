import { findScopedItem, getPortalScope, requireCan } from '../../../utils/portal'
import { directusBaseUrl } from '../../../utils/directus'

/**
 * GET /api/households/:id/photo — proxy one household photo (AFC-864,
 * person-photo precedent). The file id must be the row's own photo_file.
 * Streams bytes with the stored content type; never redirects to a bare
 * Directus URL. 404 when the household has no photo (initials instead).
 */
export default defineEventHandler(async (event) => {
  const scope = await getPortalScope(event)
  requireCan(scope, 'households', 'read')

  const id = getRouterParam(event, 'id')
  if (!id)
    throw createError({ statusCode: 400, statusMessage: 'A household id is required' })
  const found = await findScopedItem<Record<string, unknown>>(
    event,
    scope,
    'households',
    id,
    { fields: ['id', 'photo_file'] },
  )
  const file = typeof found.photo_file === 'string' ? found.photo_file : ''
  if (file === '') {
    throw createError({
      statusCode: 404,
      statusMessage: 'This household has no photo',
      data: { code: 'no_photo' },
    })
  }

  const upstream = await fetch(`${directusBaseUrl(event)}/assets/${file}`, {
    headers: scope.token ? { Authorization: `Bearer ${scope.token}` } : {},
  }).catch(() => null)
  if (!upstream || !upstream.ok || !upstream.body) {
    throw createError({
      statusCode: 503,
      statusMessage: 'The file store is unavailable',
      data: { code: 'household_photo_unavailable' },
    })
  }
  const contentType = upstream.headers.get('content-type') ?? 'application/octet-stream'
  return new Response(upstream.body, {
    headers: { 'content-type': contentType },
  })
})
