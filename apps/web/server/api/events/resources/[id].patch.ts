import { resourceDecisionSchema, resourcePatchSchema } from '@afc/shared'
import {
  findScopedItem,
  getPortalScope,
  requireCan,
  throwStoreUnavailable,
  throwValidation,
  updateItem,
} from '../../../utils/portal'

const TERMINAL: Record<string, readonly string[]> = {
  pending: ['approved', 'rejected'],
  approved: ['rejected'],
  rejected: ['approved'],
}

/**
 * PATCH /api/events/resources/:id — correct a pending item, or record a
 * decision (AFC-844). Draft fields (speaker, title, kind, url, file_id)
 * edit only while pending; decisions follow the pending/approved/rejected
 * table and stamp the decider. Only approved rows render on the Resources
 * page, so approval is the publish step.
 */
export default defineEventHandler(async (event) => {
  const scope = await getPortalScope(event)
  requireCan(scope, 'event_resources', 'update')

  const id = getRouterParam(event, 'id')
  if (!id)
    throw createError({ statusCode: 400, statusMessage: 'A resource id is required' })
  try {
    const existing = await findScopedItem<Record<string, unknown>>(
      event,
      scope,
      'event_resources',
      id,
      { fields: ['id', 'event', 'status', 'source_type'] },
    )
    await findScopedItem(event, scope, 'events', String(existing.event), {
      fields: ['id'],
    })
    const current = String(existing.status ?? 'pending')
    const body = await readBody<Record<string, unknown>>(event)

    if (body.status !== undefined) {
      const parsed = resourceDecisionSchema.safeParse(body)
      if (!parsed.success) throwValidation(parsed.error)
      const allowed = TERMINAL[current] ?? []
      if (!allowed.includes(parsed.data.status)) {
        throw createError({
          statusCode: 400,
          statusMessage: `A ${current} resource cannot move to ${parsed.data.status}`,
          data: { code: 'invalid_transition' },
        })
      }
      const updated = await updateItem<Record<string, unknown>>(
        event,
        scope,
        'event_resources',
        id,
        {
          status: parsed.data.status,
          decided_by: scope.session.user.id,
          decided_at: new Date().toISOString(),
        },
      )
      return { data: updated }
    }

    if (current !== 'pending') {
      throw createError({
        statusCode: 400,
        statusMessage: 'Only a pending resource can be corrected',
        data: { code: 'invalid_transition' },
      })
    }
    const parsed = resourcePatchSchema.safeParse(body)
    if (!parsed.success) throwValidation(parsed.error)
    if (Object.keys(parsed.data).length === 0) {
      throw createError({
        statusCode: 400,
        statusMessage: 'Nothing to update',
        data: { code: 'validation_error' },
      })
    }
    if (
      parsed.data.speaker !== undefined &&
      parsed.data.speaker !== null &&
      parsed.data.speaker !== ''
    ) {
      await findScopedItem(event, scope, 'event_speakers', parsed.data.speaker, {
        fields: ['id', 'event'],
      })
    }
    const sourceType = String(existing.source_type ?? 'link')
    const nextUrl =
      parsed.data.url !== undefined ? parsed.data.url?.trim() || null : undefined
    const nextFile =
      parsed.data.file_id !== undefined ? parsed.data.file_id?.trim() || null : undefined
    if (
      (nextUrl !== undefined && sourceType === 'link' && nextUrl === null) ||
      (nextFile !== undefined && sourceType === 'upload' && nextFile === null)
    ) {
      throw createError({
        statusCode: 400,
        statusMessage: 'A link needs its URL; an upload needs its file',
        data: { code: 'validation_error', fields: { url: 'Required for this source' } },
      })
    }
    const updated = await updateItem<Record<string, unknown>>(
      event,
      scope,
      'event_resources',
      id,
      {
        ...(parsed.data.speaker !== undefined
          ? { speaker: parsed.data.speaker === '' ? null : parsed.data.speaker }
          : {}),
        ...(parsed.data.title !== undefined ? { title: parsed.data.title } : {}),
        ...(parsed.data.kind !== undefined ? { kind: parsed.data.kind } : {}),
        ...(nextUrl !== undefined ? { url: nextUrl } : {}),
        ...(nextFile !== undefined ? { file_id: nextFile } : {}),
      },
    )
    return { data: updated }
  } catch (error) {
    if ((error as { statusCode?: number })?.statusCode) throw error
    throwStoreUnavailable(error, 'resource_store', '0054')
  }
})
