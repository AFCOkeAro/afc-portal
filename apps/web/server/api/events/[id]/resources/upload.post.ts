import { can, getPortalScope, throwStoreUnavailable } from '../../../../utils/portal'
import { directusBaseUrl } from '../../../../utils/directus'

const MAX_BYTES = 50 * 1024 * 1024
const ALLOWED_TYPES = new Set([
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/csv',
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'video/mp4',
  'video/webm',
  'application/zip',
  'application/x-zip-compressed',
])

/**
 * POST /api/events/:id/resources/upload — receive one resource file and
 * store it in Directus, returning the file id (AFC-844). The id is then
 * sent as `file_id` on the resource create, so the upload and the
 * catalogue row stay two auditable steps (receipt precedent, AFC-824).
 *
 * Guards: same gates as the resource create — `events` update (the
 * programme owner) OR `event_resources` create. One file per request,
 * 50 MB cap (video and zip need headroom over the 10 MB receipt cap).
 * Documents, spreadsheets, PDFs, images, video and archives only.
 *
 * Note: the upload rides the session user's Directus token, so the
 * caller's Directus role needs `create` on `directus_files` (portal
 * super_admin and the Administrator system role already hold it).
 */
export default defineEventHandler(async (event) => {
  const scope = await getPortalScope(event)
  if (!can(scope, 'events', 'update') && !can(scope, 'event_resources', 'create')) {
    throw createError({
      statusCode: 403,
      statusMessage: 'Your role cannot share resources on this event',
      data: { code: 'forbidden' },
    })
  }

  const parts = await readMultipartFormData(event).catch(() => null)
  const file = parts?.find((part) => part.name === 'file' && part.data?.length)
  if (!file) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Choose a file to upload',
      data: {
        code: 'validation_error',
        fields: { file: 'Choose a document, image, video or zip' },
      },
    })
  }
  if (file.data.length > MAX_BYTES) {
    throw createError({
      statusCode: 400,
      statusMessage: 'That file is larger than 50 MB',
      data: {
        code: 'validation_error',
        fields: { file: 'Keep resource files under 50 MB' },
      },
    })
  }
  const mime = String(file.type ?? 'application/octet-stream')
  if (!ALLOWED_TYPES.has(mime)) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Documents, spreadsheets, PDFs, images, video or zip only',
      data: {
        code: 'validation_error',
        fields: { file: 'Send a document, spreadsheet, PDF, image, video or zip file' },
      },
    })
  }

  const form = new FormData()
  form.append(
    'file',
    new Blob([new Uint8Array(file.data)], { type: mime }),
    String(file.filename ?? 'resource'),
  )
  let stored: { data: { id: string } }
  try {
    stored = await $fetch<{ data: { id: string } }>(`${directusBaseUrl(event)}/files`, {
      method: 'POST',
      body: form,
      headers: scope.token ? { Authorization: `Bearer ${scope.token}` } : undefined,
    })
  } catch (error) {
    throwStoreUnavailable(error, 'resource file store', '0054')
  }
  const fileId = String(stored!.data?.id ?? '')
  if (!fileId) {
    throw createError({
      statusCode: 503,
      statusMessage: 'The file store did not return an id',
      data: { code: 'pending_migration_0054', cause: 'empty file id' },
    })
  }
  return { data: { id: fileId } }
})
