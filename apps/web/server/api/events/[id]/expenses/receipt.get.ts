import {
  eventScopeFilter,
  findScopedItem,
  getPortalScope,
  listItems,
  requireCan,
  throwStoreUnavailable,
} from '../../../../utils/portal'
import { directusBaseUrl } from '../../../../utils/directus'

/**
 * GET /api/events/:id/expenses/receipt?file=<uuid> — stream a linked
 * expense receipt (AFC-824). The browser holds no Directus token, so a
 * direct /assets link would 401; this proxy authorises first, then streams
 * with the server token.
 *
 * Guards: `event_expenses` read, the event in the caller's scope, AND the
 * file linked from an expense on this exact event (fail-closed 404
 * otherwise — an unlinked file id, even a valid one, never streams).
 * Content comes from Directus with its stored type; served inline.
 */
export default defineEventHandler(async (event) => {
  const scope = await getPortalScope(event)
  requireCan(scope, 'event_expenses', 'read')

  const id = getRouterParam(event, 'id')
  const file = String(getQuery(event).file ?? '')
  if (!id)
    throw createError({ statusCode: 400, statusMessage: 'An event id is required' })
  if (!file)
    throw createError({
      statusCode: 400,
      statusMessage: 'A file id is required',
      data: { code: 'validation_error', fields: { file: 'Pick a receipt' } },
    })

  try {
    await findScopedItem<Record<string, unknown>>(event, scope, 'events', id, {
      fields: ['id', 'branch'],
      scope: eventScopeFilter(scope),
    })

    const linked = await listItems<{ id: string }>(event, scope, 'event_expenses', {
      filter: { event: { _eq: id }, receipt: { _eq: file } },
      fields: ['id'],
      limit: 1,
    })
    if (linked.data.length === 0) {
      throw createError({
        statusCode: 404,
        statusMessage: 'That receipt is not on this event',
        data: { code: 'not_found' },
      })
    }
  } catch (error) {
    if ((error as { statusCode?: number })?.statusCode) throw error
    throwStoreUnavailable(error, 'expense store', '0044')
  }

  const config = useRuntimeConfig(event)
  const token = String(config.directusServerToken ?? '')
  if (!token) {
    throw createError({
      statusCode: 503,
      statusMessage: 'No Directus token is configured for receipt reads',
    })
  }
  const headers = { Authorization: `Bearer ${token}` }
  let meta: { data: { type?: string; filename_download?: string } }
  try {
    meta = await $fetch<{ data: { type?: string; filename_download?: string } }>(
      `${directusBaseUrl(event)}/files/${file}`,
      { query: { fields: 'id,type,filename_download' }, headers },
    )
  } catch {
    throw createError({
      statusCode: 404,
      statusMessage: 'That receipt is not on this event',
      data: { code: 'not_found' },
    })
  }
  const mime = String(meta.data?.type ?? 'application/octet-stream')
  const name = String(meta.data?.filename_download ?? 'receipt')
  try {
    const bytes = await $fetch<ArrayBuffer>(`${directusBaseUrl(event)}/assets/${file}`, {
      headers,
      responseType: 'arrayBuffer',
    })
    setResponseHeaders(event, {
      'content-type': mime,
      'content-disposition': `inline; filename="${name.replace(/"/g, '')}"`,
      'cache-control': 'private, max-age=3600',
    })
    return Buffer.from(bytes)
  } catch (error) {
    throwStoreUnavailable(error, 'expense receipt store', '0044')
    throw error
  }
})
