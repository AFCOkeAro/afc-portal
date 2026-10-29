import {
  findScopedItem,
  getPortalScope,
  requireCan,
  throwStoreUnavailable,
  updateItem,
} from '../../../utils/portal'
import { directusBaseUrl } from '../../../utils/directus'

const MAX_BYTES = 5 * 1024 * 1024
const ALLOWED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp'])

/**
 * POST /api/households/:id/photo — set the household photo (AFC-864).
 * Person-photo precedent: one file per request, images only, 5 MB cap,
 * upload-then-set in one auditable step. Gates: `households` update on a
 * scoped household. Previous file row deleted best-effort.
 */
export default defineEventHandler(async (event) => {
  const scope = await getPortalScope(event)
  requireCan(scope, 'households', 'update')

  const id = getRouterParam(event, 'id')
  if (!id)
    throw createError({ statusCode: 400, statusMessage: 'A household id is required' })
  const existing = await findScopedItem<Record<string, unknown>>(
    event,
    scope,
    'households',
    id,
    { fields: ['id', 'photo_file'] },
  )

  const parts = await readMultipartFormData(event).catch(() => null)
  const file = parts?.find((part) => part.name === 'photo' && part.data?.length)
  if (!file) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Choose a photo to upload',
      data: { code: 'validation_error', fields: { photo: 'Choose a photo' } },
    })
  }
  if (file.data.length > MAX_BYTES) {
    throw createError({
      statusCode: 400,
      statusMessage: 'That photo is larger than 5 MB',
      data: { code: 'validation_error', fields: { photo: 'Keep photos under 5 MB' } },
    })
  }
  const mime = String(file.type ?? 'application/octet-stream')
  if (!ALLOWED_TYPES.has(mime)) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Photos must be JPEG, PNG or WebP',
      data: {
        code: 'validation_error',
        fields: { photo: 'Send a JPEG, PNG or WebP photo' },
      },
    })
  }

  const form = new FormData()
  form.append(
    'file',
    new Blob([new Uint8Array(file.data)], { type: mime }),
    String(file.filename ?? 'photo'),
  )
  let stored: { data: { id: string } }
  try {
    stored = await $fetch<{ data: { id: string } }>(`${directusBaseUrl(event)}/files`, {
      method: 'POST',
      body: form,
      headers: scope.token ? { Authorization: `Bearer ${scope.token}` } : {},
    })
  } catch (error) {
    throwStoreUnavailable(error, 'household photo store', '0058')
  }
  const fileId = String(stored!.data?.id ?? '')
  if (!fileId) {
    throw createError({
      statusCode: 503,
      statusMessage: 'The file store did not return an id',
      data: { code: 'pending_migration_0058', cause: 'empty file id' },
    })
  }

  await updateItem(event, scope, 'households', id, { photo_file: fileId })

  const previous = typeof existing.photo_file === 'string' ? existing.photo_file : ''
  if (previous !== '' && previous !== fileId) {
    await fetch(`${directusBaseUrl(event)}/files/${previous}`, {
      method: 'DELETE',
      headers: scope.token ? { Authorization: `Bearer ${scope.token}` } : {},
    }).catch(() => null)
  }
  return { data: { photo_file: fileId } }
})
