import {
  personFormNeedsGuardian,
  personFormSchema,
  toPersonPayload,
} from '@afc/shared'
import { ageFromDob, createItem, getPortalScope, requireCan, resolveBranch, throwValidation } from '../../utils/portal'

export default defineEventHandler(async (event) => {
  const scope = await getPortalScope(event)
  requireCan(scope, 'people', 'create')

  const parsed = personFormSchema.safeParse(await readBody(event))
  if (!parsed.success) throwValidation(parsed.error)
  const form = parsed.data

  if (personFormNeedsGuardian(form)) {
    throw createError({
      statusCode: 400,
      statusMessage: 'A guardian is required for a person under 18',
      data: {
        code: 'validation_error',
        fields: { guardian: 'Add a guardian before saving a minor' },
      },
    })
  }

  const branch = resolveBranch(scope, form.branch)
  const age = ageFromDob(form.date_of_birth)
  const created = await createItem<Record<string, unknown>>(
    event,
    scope,
    'people',
    {
      ...toPersonPayload({ ...form, branch: branch ?? undefined }),
      is_minor: age !== null && age < 18,
      status: 'active',
    },
  )

  return { data: { ...created, id: String(created.id) } }
})
