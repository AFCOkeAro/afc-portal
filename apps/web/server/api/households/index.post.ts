import { householdFormSchema, toHouseholdPayload } from '@afc/shared'
import {
  createItem,
  findScopedItem,
  getPortalScope,
  requireCan,
  resolveBranch,
  throwStoreUnavailable,
  throwValidation,
} from '../../utils/portal'

export default defineEventHandler(async (event) => {
  const scope = await getPortalScope(event)
  requireCan(scope, 'households', 'create')

  const parsed = householdFormSchema.safeParse(await readBody(event))
  if (!parsed.success) throwValidation(parsed.error)
  const form = parsed.data

  const branch = resolveBranch(scope, form.branch)

  // AFC-566: the create hits the 0020 household register. A missing table
  // surfaces as DirectusAuthError — map it to the named store error, never
  // a bare 500. Deliberate 4xx (scope 404s) pass through untouched.
  try {
    if (form.household_head) {
      await findScopedItem(event, scope, 'people', form.household_head, {
        fields: ['id'],
      })
    }

    const created = await createItem<Record<string, unknown>>(
      event,
      scope,
      'households',
      toHouseholdPayload({ ...form, branch: branch ?? undefined }),
    )

    return { data: { ...created, id: String(created.id) } }
  } catch (error) {
    if ((error as { statusCode?: number })?.statusCode) throw error
    throwStoreUnavailable(error, 'household_store', '0020')
  }
})
