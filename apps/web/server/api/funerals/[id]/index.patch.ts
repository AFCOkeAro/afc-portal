import { funeralPatchSchema } from '@afc/shared'
import {
  findScopedItem,
  getPortalScope,
  requireCan,
  resolveBranch,
  throwStoreUnavailable,
  throwValidation,
  updateItem,
} from '../../../utils/portal'

const TERMINAL = ['held', 'cancelled']

/**
 * PATCH /api/funerals/:id — correct a case (AFC-884).
 *
 * Gated on funeral_cases update. Held/cancelled cases are read-only
 * history (correct via a new case, never by rewriting). Linking or
 * changing the person flips the newly linked row to deceased; unlinking
 * (person -> null with a name) does NOT resurrect — the flip is history.
 * Stage moves forward only: reported -> scheduled -> held, any -> cancelled;
 * approval travels exclusively through the approve route.
 */
const FORWARD: Record<string, readonly string[]> = {
  reported: ['scheduled', 'cancelled'],
  scheduled: ['held', 'cancelled'],
  approved: ['scheduled', 'cancelled'],
  held: [],
  cancelled: [],
}

export default defineEventHandler(async (event) => {
  const scope = await getPortalScope(event)
  requireCan(scope, 'funeral_cases', 'update')

  const id = getRouterParam(event, 'id')
  if (!id)
    throw createError({ statusCode: 400, statusMessage: 'A funeral id is required' })
  const body = (await readBody(event).catch(() => ({}))) as Record<string, unknown>

  const stageRaw = body.stage
  if (stageRaw !== undefined && typeof stageRaw !== 'string') {
    throw createError({
      statusCode: 400,
      statusMessage: 'That stage is not valid',
      data: { code: 'validation_error', fields: { stage: 'Pick a valid stage' } },
    })
  }

  const parsed = funeralPatchSchema.safeParse(body)
  if (!parsed.success) throwValidation(parsed.error)
  const form = parsed.data
  if (Object.keys(form).length === 0 && stageRaw === undefined) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Nothing to update',
      data: { code: 'validation_error' },
    })
  }
  try {
    const existing = await findScopedItem<Record<string, unknown>>(
      event,
      scope,
      'funeral_cases',
      id,
      { fields: ['id', 'stage', 'branch'] },
    )
    const current = String(existing.stage ?? 'reported')
    if (TERMINAL.includes(current)) {
      throw createError({
        statusCode: 400,
        statusMessage: 'A held or cancelled funeral is history and cannot change',
        data: { code: 'invalid_transition' },
      })
    }
    if (stageRaw !== undefined) {
      if (stageRaw === 'approved') {
        throw createError({
          statusCode: 400,
          statusMessage: 'Approval goes through the approve step, with its checks',
          data: { code: 'use_approve_route' },
        })
      }
      const allowed = FORWARD[current] ?? []
      if (!allowed.includes(stageRaw)) {
        throw createError({
          statusCode: 400,
          statusMessage: `A ${current} funeral cannot move to ${stageRaw}`,
          data: { code: 'invalid_transition' },
        })
      }
    }

    const branch =
      form.branch !== undefined
        ? resolveBranch(scope, form.branch ?? undefined)
        : undefined
    let personId: string | null | undefined
    if (form.deceased_person !== undefined) {
      if (form.deceased_person) {
        const person = await findScopedItem<Record<string, unknown>>(
          event,
          scope,
          'people',
          form.deceased_person,
          {
            fields: ['id'],
          },
        ).catch(() => null)
        if (!person) {
          throw createError({
            statusCode: 404,
            statusMessage: 'That person was not found in your scope',
            data: { code: 'person_not_found' },
          })
        }
        personId = String(person.id)
        await updateItem(event, scope, 'people', personId, { status: 'deceased' })
      } else {
        personId = null
      }
    }

    const patch: Record<string, unknown> = {
      ...(current === 'approved' && form.songs !== undefined
        ? { stage: 'reported', programme_approved_by: null, programme_approved_at: null }
        : {}),
    }
    if (branch !== undefined) patch.branch = branch
    if (personId !== undefined) patch.deceased_person = personId
    if (form.deceased_name !== undefined)
      patch.deceased_name = form.deceased_name?.trim() || null
    if (form.songs !== undefined) patch.songs = form.songs
    if (form.service_of_songs_date !== undefined)
      patch.service_of_songs_date = form.service_of_songs_date
    if (form.funeral_date !== undefined) patch.funeral_date = form.funeral_date
    if (form.service_of_songs_attendance !== undefined)
      patch.service_of_songs_attendance = form.service_of_songs_attendance
    if (form.funeral_attendance !== undefined)
      patch.funeral_attendance = form.funeral_attendance
    if (form.notes !== undefined) patch.notes = form.notes?.trim() || null
    if (stageRaw !== undefined) patch.stage = stageRaw
    const updated = await updateItem(
      event,
      scope,
      'funeral_cases',
      id,
      Object.fromEntries(
        Object.entries(patch).filter(([, value]) => value !== undefined),
      ),
    )
    return { data: updated }
  } catch (error) {
    if ((error as { statusCode?: number })?.statusCode) throw error
    throwStoreUnavailable(error, 'funeral_store', '0062')
  }
})
