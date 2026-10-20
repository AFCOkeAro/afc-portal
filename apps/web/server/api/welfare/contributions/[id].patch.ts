import { directusFetch } from '../../../utils/directus'
import {
  createItem,
  findScopedItem,
  getPortalScope,
  requireCan,
  updateItem,
} from '../../../utils/portal'

const STATUSES = ['pending', 'approved', 'disbursed'] as const

export default defineEventHandler(async (event) => {
  const scope = await getPortalScope(event)
  requireCan(scope, 'welfare_contributions', 'update')

  const id = getRouterParam(event, 'id')
  if (!id)
    throw createError({ statusCode: 400, statusMessage: 'A contribution id is required' })

  const body = (await readBody(event)) as { status?: unknown }
  if (!body.status || !STATUSES.includes(body.status as (typeof STATUSES)[number])) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Choose a contribution status',
      data: { code: 'validation_error', fields: { status: 'Choose a status' } },
    })
  }
  const status = body.status as (typeof STATUSES)[number]

  const contribution = await directusFetch<{
    data: { id: string | number; case: string; status: string }
  }>(event, `/items/welfare_contributions/${id}`, {
    accessToken: scope.token,
    query: { fields: 'id,case,status' },
  })
  await findScopedItem(event, scope, 'welfare_cases', contribution.data.case, {
    fields: ['id'],
  })

  const now = new Date().toISOString()
  const updated = await updateItem<Record<string, unknown>>(
    event,
    scope,
    'welfare_contributions',
    id,
    {
      status,
      approved_by: status === 'pending' ? null : scope.session.user.id,
      approved_at: status === 'pending' ? null : now,
    },
  )

  const statusSummary = `Contribution marked ${status}`
  await createItem(event, scope, 'welfare_case_events', {
    case: contribution.data.case,
    event_type: 'contribution_status',
    detail: statusSummary,
    summary: statusSummary,
    actor_user: scope.session.user.id,
    actor: scope.session.user.id,
    created_at: now,
  })

  return { data: updated }
})
