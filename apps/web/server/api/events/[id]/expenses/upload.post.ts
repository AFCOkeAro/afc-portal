import { can, getPortalScope, throwStoreUnavailable } from '../../../../utils/portal'
import { collaboratorHasArea } from '../../../../utils/event-access'
import { directusBaseUrl } from '../../../../utils/directus'

const MAX_BYTES = 10 * 1024 * 1024
const ALLOWED_TYPES = new Set([
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
])

/**
 * POST /api/events/:id/expenses/upload — receive one receipt scan or photo
 * and store it in Directus, returning the file id (AFC-824). The id is then
 * sent as `receipt` on the expense create, so the upload and the spend
 * record stay two auditable steps. Expenses are append-only (no PATCH), so
 * the receipt must be uploaded before the create.
 *
 * Guards: same gates as the expense create — `events` update (the programme
 * owner correcting their own books) OR `event_expenses` create (the finance
 * recorder). One file per request, 10 MB cap, PDF/JPEG/PNG/WebP only.
 * Anything else answers 400 {code, fields}; an unreachable Directus answers
 * 503, never a bare 500.
 *
 * Note: the upload rides the session user's Directus token, so the caller's
 * Directus role needs `create` on `directus_files` (portal super_admin and
 * the Administrator system role already hold it).
 */
export default defineEventHandler(async (event) => {
  const scope = await getPortalScope(event)
  const collaboratorEvent = getRouterParam(event, 'id')
  const collaboratorOk = collaboratorEvent
    ? await collaboratorHasArea(event, scope, collaboratorEvent, 'budget')
    : false
  if (!can(scope, 'events', 'update') && !can(scope, 'event_expenses', 'create')) {
    if (!collaboratorOk)
      throw createError({
        statusCode: 403,
        statusMessage: 'Your role cannot record expenses on this event',
        data: { code: 'forbidden' },
      })
  }

  const parts = await readMultipartFormData(event).catch(() => null)
  const file = parts?.find((part) => part.name === 'file' && part.data?.length)
  if (!file) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Choose a receipt to upload',
      data: { code: 'validation_error', fields: { file: 'Choose a scan or photo' } },
    })
  }
  if (file.data.length > MAX_BYTES) {
    throw createError({
      statusCode: 400,
      statusMessage: 'That file is larger than 10 MB',
      data: {
        code: 'validation_error',
        fields: { file: 'Keep scans and photos under 10 MB' },
      },
    })
  }
  const mime = String(file.type ?? 'application/octet-stream')
  if (!ALLOWED_TYPES.has(mime)) {
    throw createError({
      statusCode: 400,
      statusMessage: 'PDF, JPEG, PNG or WebP only',
      data: {
        code: 'validation_error',
        fields: { file: 'Send a PDF, JPEG, PNG or WebP file' },
      },
    })
  }

  const form = new FormData()
  form.append(
    'file',
    new Blob([new Uint8Array(file.data)], { type: mime }),
    String(file.filename ?? 'receipt'),
  )
  let stored: { data: { id: string } }
  try {
    stored = await $fetch<{ data: { id: string } }>(`${directusBaseUrl(event)}/files`, {
      method: 'POST',
      body: form,
      headers: scope.token ? { Authorization: `Bearer ${scope.token}` } : undefined,
    })
  } catch (error) {
    throwStoreUnavailable(error, 'expense receipt store', '0044')
  }
  const fileId = String(stored!.data?.id ?? '')
  if (!fileId) {
    throw createError({
      statusCode: 503,
      statusMessage: 'The file store did not return an id',
      data: { code: 'pending_migration_0044', cause: 'empty file id' },
    })
  }
  return { data: { id: fileId } }
})
