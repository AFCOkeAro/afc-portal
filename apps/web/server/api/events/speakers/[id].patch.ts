import { speakerPatchSchema } from '@afc/shared'
import {
  findScopedItem,
  getPortalScope,
  requireCan,
  throwStoreUnavailable,
  throwValidation,
  updateItem,
} from '../../../utils/portal'

/**
 * PATCH /api/events/speakers/:id — move status, edit requests/bio.
 * Person/name are write-once (stamped at booking); the booking itself is
 * corrected by re-booking, never by swapping who it names.
 */
export default defineEventHandler(async (event) => {
  const scope = await getPortalScope(event)
  requireCan(scope, 'event_speakers', 'update')

  const id = getRouterParam(event, 'id')
  if (!id)
    throw createError({ statusCode: 400, statusMessage: 'A booking id is required' })
  try {
    const existing = await findScopedItem<Record<string, unknown>>(
      event,
      scope,
      'event_speakers',
      id,
      { fields: ['id', 'event'] },
    )
    await findScopedItem(event, scope, 'events', String(existing.event), {
      fields: ['id'],
    })

    const parsed = speakerPatchSchema.safeParse(await readBody(event))
    if (!parsed.success) throwValidation(parsed.error)
    if (Object.keys(parsed.data).length === 0) {
      throw createError({
        statusCode: 400,
        statusMessage: 'Nothing to update',
        data: { code: 'validation_error' },
      })
    }
    const updated = await updateItem<Record<string, unknown>>(
      event,
      scope,
      'event_speakers',
      id,
      {
        ...(parsed.data.status !== undefined ? { status: parsed.data.status } : {}),
        ...(parsed.data.special_requests !== undefined
          ? { special_requests: parsed.data.special_requests ?? null }
          : {}),
        ...(parsed.data.bio !== undefined ? { bio: parsed.data.bio ?? null } : {}),
      },
    )
    return { data: updated }
  } catch (error) {
    if ((error as { statusCode?: number })?.statusCode) throw error
    throwStoreUnavailable(error, 'speaker_store', '0053')
  }
})
