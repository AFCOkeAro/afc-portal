import { householdMemberLinkSchema } from '@afc/shared'
import {
  findScopedItem,
  getPortalScope,
  requireCan,
  throwStoreUnavailable,
  throwValidation,
  updateItem,
} from '../../../utils/portal'

/**
 * DELETE /api/households/:id/members — unlink a person from the household.
 *
 * Clears `people.household`. When the unlinked person is the household head,
 * the head pointer is cleared too so the detail page never names a head who
 * no longer belongs. Body (or `?person=`) names exactly one person.
 */
export default defineEventHandler(async (event) => {
  const scope = await getPortalScope(event)
  requireCan(scope, 'households', 'update')
  requireCan(scope, 'people', 'update')

  const id = getRouterParam(event, 'id')
  if (!id) {
    throw createError({ statusCode: 400, statusMessage: 'A household id is required' })
  }
  // AFC-566: scope-gate and head-clear hit the 0020 register; the unlink
  // clears people.household (0020 column). Unreadable store → named error,
  // never a bare 500; deliberate 404s pass through untouched.
  try {
    const household = await findScopedItem<Record<string, unknown>>(
      event,
      scope,
      'households',
      id,
      { fields: ['id', 'household_head'] },
    )

    const query = getQuery(event)
    const parsed = householdMemberLinkSchema.safeParse(
      (await readBody(event).catch(() => null)) ??
        (typeof query.person === 'string' ? { person: query.person } : null),
    )
    if (!parsed.success) throwValidation(parsed.error)

    const person = await findScopedItem<Record<string, unknown>>(
      event,
      scope,
      'people',
      parsed.data.person,
      { fields: ['id', 'household'] },
    )
    if (!person.household || String(person.household) !== id) {
      throw createError({
        statusCode: 404,
        statusMessage: 'That person is not a member of this household',
        data: { code: 'not_found' },
      })
    }

    await updateItem(event, scope, 'people', parsed.data.person, { household: null })
    if (
      household.household_head &&
      String(household.household_head) === parsed.data.person
    ) {
      await updateItem(event, scope, 'households', id, { household_head: null })
    }
    return { data: { id: parsed.data.person, household: null } }
  } catch (error) {
    if ((error as { statusCode?: number })?.statusCode) throw error
    throwStoreUnavailable(error, 'household_store', '0020')
  }
})
