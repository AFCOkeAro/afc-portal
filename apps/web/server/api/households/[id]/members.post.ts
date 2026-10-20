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
 * POST /api/households/:id/members — link a person into the household.
 *
 * The link is the `people.household` M2O, so both grants are required: the
 * caller must be allowed to edit the household AND the person row. Moving a
 * person who already belongs to another household is a 409: unlink first, so
 * a mistyped id cannot silently re-home a child.
 */
export default defineEventHandler(async (event) => {
  const scope = await getPortalScope(event)
  requireCan(scope, 'households', 'update')
  requireCan(scope, 'people', 'update')

  const id = getRouterParam(event, 'id')
  if (!id) {
    throw createError({ statusCode: 400, statusMessage: 'A household id is required' })
  }
  // AFC-566: the household scope-gate hits the 0020 register; the link
  // itself moves people.household (0020 column). Map an unreadable store
  // to the named error, never a bare 500 — the 409 conflict and scope 404s
  // are deliberate 4xx and pass through untouched.
  try {
    await findScopedItem(event, scope, 'households', id, { fields: ['id'] })

    const parsed = householdMemberLinkSchema.safeParse(await readBody(event))
    if (!parsed.success) throwValidation(parsed.error)

    const person = await findScopedItem<Record<string, unknown>>(
      event,
      scope,
      'people',
      parsed.data.person,
      { fields: ['id', 'household'] },
    )
    const current = person.household ? String(person.household) : null
    if (current !== null && current !== id) {
      throw createError({
        statusCode: 409,
        statusMessage: 'That person already belongs to another household',
        data: {
          code: 'household_conflict',
          fields: { person: 'Unlink from the current household first' },
        },
      })
    }
    if (current === id) return { data: { id: String(person.id), household: id } }

    const updated = await updateItem<Record<string, unknown>>(
      event,
      scope,
      'people',
      parsed.data.person,
      { household: id },
    )
    return { data: { id: String(updated.id), household: id } }
  } catch (error) {
    if ((error as { statusCode?: number })?.statusCode) throw error
    throwStoreUnavailable(error, 'household_store', '0020')
  }
})
