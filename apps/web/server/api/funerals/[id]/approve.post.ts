import {
  findScopedItem,
  getPortalScope,
  requireCan,
  throwStoreUnavailable,
  updateItem,
} from '../../../utils/portal'

/**
 * POST /api/funerals/:id/approve — music-director programme approval
 * (AFC-884). Gated on funeral_cases update. Requires both documents plus
 * at least one song: an approval without the paper trail or the programme
 * is refused, never recorded half-done. Sets approver + timestamp and
 * moves reported/documents to approved.
 */
export default defineEventHandler(async (event) => {
  const scope = await getPortalScope(event)
  requireCan(scope, 'funeral_cases', 'update')

  const id = getRouterParam(event, 'id')
  if (!id)
    throw createError({ statusCode: 400, statusMessage: 'A funeral id is required' })
  try {
    const existing = await findScopedItem<Record<string, unknown>>(
      event,
      scope,
      'funeral_cases',
      id,
      {
        fields: ['id', 'stage', 'death_certificate_file', 'consent_letter_file', 'songs'],
      },
    )
    const current = String(existing.stage ?? 'reported')
    if (current !== 'reported') {
      throw createError({
        statusCode: 400,
        statusMessage: `A ${current} funeral cannot be approved`,
        data: { code: 'invalid_transition' },
      })
    }
    if (!existing.death_certificate_file || !existing.consent_letter_file) {
      throw createError({
        statusCode: 400,
        statusMessage:
          'Both the death certificate and the family consent letter are required before approval',
        data: { code: 'documents_incomplete' },
      })
    }
    const songs = Array.isArray(existing.songs) ? existing.songs : []
    if (songs.length === 0) {
      throw createError({
        statusCode: 400,
        statusMessage: 'The programme needs at least one song before approval',
        data: { code: 'programme_empty' },
      })
    }
    const updated = await updateItem<Record<string, unknown>>(
      event,
      scope,
      'funeral_cases',
      id,
      {
        stage: 'approved',
        programme_approved_by: scope.session.user.id,
        programme_approved_at: new Date().toISOString(),
      },
    )
    return { data: updated }
  } catch (error) {
    if ((error as { statusCode?: number })?.statusCode) throw error
    throwStoreUnavailable(error, 'funeral_store', '0062')
  }
})
