import { householdFormSchema, toHouseholdPayload } from '@afc/shared'
import {
  createItem,
  findScopedItem,
  getPortalScope,
  requireCan,
  resolveBranch,
  throwValidation,
} from '../../utils/portal'

export default defineEventHandler(async (event) => {
  const scope = await getPortalScope(event)
  requireCan(scope, 'households', 'create')

  const parsed = householdFormSchema.safeParse(await readBody(event))
  if (!parsed.success) throwValidation(parsed.error)
  const form = parsed.data

  const branch = resolveBranch(scope, form.branch)

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
})
