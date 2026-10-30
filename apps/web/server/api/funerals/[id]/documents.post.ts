import {
  findScopedItem,
  getPortalScope,
  requireCan,
  throwStoreUnavailable,
  updateItem,
} from '../../../utils/portal'
import { directusBaseUrl } from '../../../utils/directus'

const MAX_BYTES = 10 * 1024 * 1024
const ALLOWED_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/pdf',
])
const SLOTS = {
  death_certificate: 'death_certificate_file',
  consent_letter: 'consent_letter_file',
} as const

/**
 * POST /api/funerals/:id/documents — upload a paper-trail document
 * (AFC-884). Multipart field `file`, query `?slot=death_certificate |
 * consent_letter`. Images or PDF, 10 MB cap. Uploads ride the session
 * Directus token (needs files create, same as resources); the file id is
 * stored on the named slot. Uploading to an approved programme demotes it
 * back to reported — the music director re-approves the new paper.
 */
export default defineEventHandler(async (event) => {
  const scope = await getPortalScope(event)
  requireCan(scope, 'funeral_cases', 'update')

  const id = getRouterParam(event, 'id')
  if (!id)
    throw createError({ statusCode: 400, statusMessage: 'A funeral id is required' })
  const query = getQuery(event)
  const slot = typeof query.slot === 'string' ? query.slot : ''
  if (!(slot in SLOTS)) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Choose which document this is',
      data: {
        code: 'validation_error',
        fields: { slot: 'death_certificate or consent_letter' },
      },
    })
  }
  const column = SLOTS[slot as keyof typeof SLOTS]

  const parts = await readMultipartFormData(event).catch(() => null)
  const file = parts?.find((part) => part.name === 'file' && part.data?.length)
  if (!file) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Choose a file to upload',
      data: { code: 'validation_error', fields: { file: 'Choose a file' } },
    })
  }
  if (file.data.length > MAX_BYTES) {
    throw createError({
      statusCode: 400,
      statusMessage: 'That file is larger than 10 MB',
      data: { code: 'validation_error', fields: { file: 'Keep documents under 10 MB' } },
    })
  }
  const mime = String(file.type ?? 'application/octet-stream')
  if (!ALLOWED_TYPES.has(mime)) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Documents must be JPEG, PNG, WebP or PDF',
      data: { code: 'validation_error', fields: { file: 'Send an image or PDF' } },
    })
  }

  try {
    const existing = await findScopedItem<Record<string, unknown>>(
      event,
      scope,
      'funeral_cases',
      id,
      { fields: ['id', 'stage', column] },
    )
    if (['held', 'cancelled'].includes(String(existing.stage ?? ''))) {
      throw createError({
        statusCode: 400,
        statusMessage: 'A held or cancelled funeral is history and cannot change',
        data: { code: 'invalid_transition' },
      })
    }
    const form = new FormData()
    form.append(
      'file',
      new Blob([new Uint8Array(file.data)], { type: mime }),
      String(file.filename ?? 'document'),
    )
    let stored: { data: { id: string } }
    try {
      stored = await $fetch<{ data: { id: string } }>(`${directusBaseUrl(event)}/files`, {
        method: 'POST',
        body: form,
        headers: scope.token ? { Authorization: `Bearer ${scope.token}` } : {},
      })
    } catch (error) {
      throwStoreUnavailable(error, 'funeral document store', '0062')
    }
    const fileId = String(stored!.data?.id ?? '')
    if (!fileId) {
      throw createError({
        statusCode: 503,
        statusMessage: 'The file store did not return an id',
        data: { code: 'pending_migration_0062', cause: 'empty file id' },
      })
    }
    const previous = typeof existing[column] === 'string' ? String(existing[column]) : ''
    const patch: Record<string, unknown> = { [column]: fileId }
    if (String(existing.stage ?? '') === 'approved') {
      patch.stage = 'reported'
      patch.programme_approved_by = null
      patch.programme_approved_at = null
    }
    await updateItem(event, scope, 'funeral_cases', id, patch)
    if (previous !== '' && previous !== fileId) {
      await fetch(`${directusBaseUrl(event)}/files/${previous}`, {
        method: 'DELETE',
        headers: scope.token ? { Authorization: `Bearer ${scope.token}` } : {},
      }).catch(() => null)
    }
    return { data: { [column]: fileId } }
  } catch (error) {
    if ((error as { statusCode?: number })?.statusCode) throw error
    throwStoreUnavailable(error, 'funeral_store', '0062')
  }
})
