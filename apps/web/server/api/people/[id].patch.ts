import { personFormNeedsGuardian, personFormSchema, toPersonPayload } from '@afc/shared'
import {
  ageFromDob,
  findScopedItem,
  getPortalScope,
  isHidden,
  requireCan,
  resolveBranch,
  throwValidation,
  updateItem,
} from '../../utils/portal'

export default defineEventHandler(async (event) => {
  const scope = await getPortalScope(event)
  requireCan(scope, 'people', 'update')

  const id = getRouterParam(event, 'id')
  if (!id)
    throw createError({ statusCode: 400, statusMessage: 'A person id is required' })
  const existing = await findScopedItem<Record<string, unknown>>(
    event,
    scope,
    'people',
    id,
    { fields: ['id', 'date_of_birth', 'is_minor'] },
  )

  const body = (await readBody(event)) as Record<string, unknown>

  if (
    Object.keys(body).length === 1 &&
    (body.status === 'active' || body.status === 'archived')
  ) {
    const updated = await updateItem<Record<string, unknown>>(
      event,
      scope,
      'people',
      id,
      { status: body.status },
    )
    return { data: updated }
  }

  const parsed = personFormSchema.safeParse(body)
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
  const payload: Record<string, unknown> = {
    ...toPersonPayload({ ...form, branch: branch ?? undefined }),
    is_minor: age !== null && age < 18,
  }
  if (isHidden(scope, 'people', 'date_of_birth')) {
    payload.date_of_birth = existing.date_of_birth as string | null
    payload.is_minor = existing.is_minor as boolean | null
  }
  const updated = await updateItem<Record<string, unknown>>(
    event,
    scope,
    'people',
    id,
    payload,
  )
  return { data: updated }
})
