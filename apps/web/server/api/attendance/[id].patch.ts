import { attendanceSessionFormSchema, headcountTotal } from '@afc/shared'
import {
  findScopedItem,
  getPortalScope,
  requireCan,
  resolveBranch,
  throwValidation,
  updateItem,
} from '../../utils/portal'

export default defineEventHandler(async (event) => {
  const scope = await getPortalScope(event)
  requireCan(scope, 'attendance_sessions', 'update')

  const id = getRouterParam(event, 'id')
  if (!id)
    throw createError({ statusCode: 400, statusMessage: 'A session id is required' })
  await findScopedItem(event, scope, 'attendance_sessions', id, { fields: ['id'] })

  const parsed = attendanceSessionFormSchema.safeParse(await readBody(event))
  if (!parsed.success) throwValidation(parsed.error)
  const form = parsed.data
  const branch = resolveBranch(scope, form.branch)

  const updated = await updateItem<Record<string, unknown>>(
    event,
    scope,
    'attendance_sessions',
    id,
    {
      branch: branch ?? null,
      session_date: form.session_date,
      session_type: form.session_type,
      session_name: form.session_name,
      service: form.service ?? null,
      event: form.event ?? null,
      headcount_men: form.headcount_men,
      headcount_women: form.headcount_women,
      headcount_children: form.headcount_children,
      headcount_total: headcountTotal(form),
      recorded_by: scope.session.user.id,
      recorded_at: new Date().toISOString(),
    },
  )
  return { data: updated }
})
