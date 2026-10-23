import { attendeeFormSchema } from '@afc/shared'
import {
  createItem,
  findScopedItem,
  getPortalScope,
  requireCan,
  scopeFilter,
  throwValidation,
} from '../../../utils/portal'

/** POST /api/minutes/:id/attendees — attach a person/user attendee (US-E3 AC2). */
export default defineEventHandler(async (event) => {
  const scope = await getPortalScope(event)
  requireCan(scope, 'office_minutes', 'update')

  const id = String(getRouterParam(event, 'id'))
  await findScopedItem(event, scope, 'office_minutes', id, { scope: scopeFilter(scope) })

  const parsed = attendeeFormSchema.safeParse(await readBody(event))
  if (!parsed.success) throwValidation(parsed.error)

  const created = await createItem<Record<string, unknown>>(
    event,
    scope,
    'minutes_attendees',
    {
      minute: id,
      person: parsed.data.person ?? null,
      attendee_user: parsed.data.attendee_user ?? null,
    },
  )
  return { data: { ...created, id: String(created.id) } }
})
