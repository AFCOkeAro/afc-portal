import { attendanceSessionFormSchema, headcountTotal } from '@afc/shared'
import {
  createItem,
  getPortalScope,
  requireCan,
  resolveBranch,
  throwValidation,
} from '../../utils/portal'

export default defineEventHandler(async (event) => {
  const scope = await getPortalScope(event)
  requireCan(scope, 'attendance_sessions', 'create')

  const parsed = attendanceSessionFormSchema.safeParse(await readBody(event))
  if (!parsed.success) throwValidation(parsed.error)
  const form = parsed.data
  const branch = resolveBranch(scope, form.branch)

  const created = await createItem<Record<string, unknown>>(
    event,
    scope,
    'attendance_sessions',
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
  return { data: { ...created, id: String(created.id) } }
})
