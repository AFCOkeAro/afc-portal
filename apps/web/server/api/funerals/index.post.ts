import { funeralFormSchema } from '@afc/shared'
import {
  createItem,
  findScopedItem,
  getPortalScope,
  requireCan,
  resolveBranch,
  throwStoreUnavailable,
  throwValidation,
  updateItem,
} from '../../utils/portal'

/**
 * POST /api/funerals — open a funeral case (AFC-884).
 *
 * Gated on funeral_cases create (branch programme admin). Branch resolves
 * from the caller's scope unless an explicit in-scope branch is named.
 * Linking a person flips their status to deceased FIRST (route-owned
 * write, never a client-sent status): a permission or scope problem
 * fails fast, before any funeral row exists.
 */
export default defineEventHandler(async (event) => {
  const scope = await getPortalScope(event)
  requireCan(scope, 'funeral_cases', 'create')

  const parsed = funeralFormSchema.safeParse(await readBody(event))
  if (!parsed.success) throwValidation(parsed.error)
  const form = parsed.data
  try {
    const branch = resolveBranch(scope, form.branch ?? undefined)
    if (!branch) {
      throw createError({
        statusCode: 400,
        statusMessage: 'A branch is required for a funeral case',
        data: { code: 'validation_error', fields: { branch: 'Choose a branch' } },
      })
    }
    let zone: string | null = null
    const branchRow = await findScopedItem<Record<string, unknown>>(
      event,
      scope,
      'branches',
      branch,
      { fields: ['zone'] },
    ).catch(() => null)
    const rawZone = branchRow?.zone
    zone = typeof rawZone === 'string' && rawZone.length > 0 ? rawZone : null

    let personId: string | null = null
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
    }

    const created = await createItem<Record<string, unknown>>(
      event,
      scope,
      'funeral_cases',
      {
        branch,
        zone,
        deceased_person: personId,
        deceased_name: personId ? null : (form.deceased_name?.trim() ?? null),
        stage: 'reported',
        songs: form.songs ?? [],
        service_of_songs_date: form.service_of_songs_date ?? null,
        funeral_date: form.funeral_date ?? null,
        service_of_songs_attendance: form.service_of_songs_attendance ?? null,
        funeral_attendance: form.funeral_attendance ?? null,
        notes: form.notes?.trim() || null,
        created_by: scope.session.user.id,
      },
    )
    return { data: created }
  } catch (error) {
    if ((error as { statusCode?: number })?.statusCode) throw error
    throwStoreUnavailable(error, 'funeral_store', '0062')
  }
})
