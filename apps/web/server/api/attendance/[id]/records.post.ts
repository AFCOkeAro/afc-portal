import { attendanceRecordFormSchema } from '@afc/shared'
import {
  createItem,
  findScopedItem,
  getPortalScope,
  requireCan,
  throwValidation,
} from '../../../utils/portal'

export default defineEventHandler(async (event) => {
  const scope = await getPortalScope(event)
  requireCan(scope, 'attendance_records', 'create')

  const id = getRouterParam(event, 'id')
  if (!id)
    throw createError({ statusCode: 400, statusMessage: 'A session id is required' })
  await findScopedItem(event, scope, 'attendance_sessions', id, { fields: ['id'] })

  const parsed = attendanceRecordFormSchema.safeParse(await readBody(event))
  if (!parsed.success) throwValidation(parsed.error)
  const form = parsed.data

  if (!form.person && !form.attendee_name) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Choose a person or type a name to check in',
      data: {
        code: 'validation_error',
        fields: { attendee_name: 'Choose a person or type a name' },
      },
    })
  }

  if (form.person) {
    await findScopedItem(event, scope, 'people', form.person, { fields: ['id'] })
  }

  const created = await createItem<Record<string, unknown>>(
    event,
    scope,
    'attendance_records',
    {
      session: id,
      person: form.person ?? null,
      attendee_name: form.attendee_name ?? null,
      attendance_category: form.attendance_category ?? 'member',
      recorded_by: scope.session.user.id,
      recorded_at: new Date().toISOString(),
    },
  )
  return { data: { ...created, id: String(created.id) } }
})
