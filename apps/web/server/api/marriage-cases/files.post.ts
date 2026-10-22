import { getPortalScope, requireCan, throwStoreUnavailable } from '../../utils/portal'
import { directusBaseUrl } from '../../utils/directus'

const MAX_BYTES = 10 * 1024 * 1024
const ALLOWED_TYPES = new Set([
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
])

/**
 * POST /api/marriage-cases/files — receive one scan or photo and store it
 * in Directus, returning the file id (AFC-677 phase B). The id is then
 * linked into a case slot via PATCH /api/marriage-cases/:id/files, so the
 * upload and the case write stay two auditable steps.
 *
 * Guards: staff only (requireCan on the pipeline), one file per request,
 * 10 MB cap, PDF/JPEG/PNG/WebP only. Anything else answers 400
 * {code, fields}; an unreachable Directus answers 503, never a bare 500.
 */
export default defineEventHandler(async (event) => {
  const scope = await getPortalScope(event)
  requireCan(scope, 'marriage_cases', 'update')

  const parts = await readMultipartFormData(event).catch(() => null)
  const file = parts?.find((part) => part.name === 'file' && part.data?.length)
  if (!file) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Choose a file to upload',
      data: { code: 'validation_error', fields: { file: 'Choose a scan or photo' } },
    })
  }
  if (file.data.length > MAX_BYTES) {
    throw createError({
      statusCode: 400,
      statusMessage: 'That file is larger than 10 MB',
      data: { code: 'validation_error', fields: { file: 'Keep scans and photos under 10 MB' } },
    })
  }
  const mime = String(file.type ?? 'application/octet-stream')
  if (!ALLOWED_TYPES.has(mime)) {
    throw createError({
      statusCode: 400,
      statusMessage: 'PDF, JPEG, PNG or WebP only',
      data: { code: 'validation_error', fields: { file: 'Send a PDF, JPEG, PNG or WebP file' } },
    })
  }

  const form = new FormData()
  form.append(
    'file',
    new Blob([new Uint8Array(file.data)], { type: mime }),
    String(file.filename ?? 'upload'),
  )
  let stored: { data: { id: string } }
  try {
    stored = await $fetch<{ data: { id: string } }>(
      `${directusBaseUrl(event)}/files`,
      {
        method: 'POST',
        body: form,
        headers: scope.token ? { Authorization: `Bearer ${scope.token}` } : undefined,
      },
    )
  } catch (error) {
    throwStoreUnavailable(error, 'marriage file store', '0036')
  }
  const fileId = String(stored!.data?.id ?? '')
  if (!fileId) {
    throw createError({
      statusCode: 503,
      statusMessage: 'The file store did not return an id',
      data: { code: 'pending_migration_0036', cause: 'empty file id' },
    })
  }
  return { data: { id: fileId } }
})
