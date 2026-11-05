import { COLLECTIONS, leaveRequestFormSchema } from '@afc/shared'
import {
  createItem,
  findScopedItem,
  getPortalScope,
  listItems,
  requireCan,
  resolveBranch,
  throwValidation,
} from '../../utils/portal'
import { logScopedQuery, writeOfficeAudit } from '../../utils/office'

/**
 * POST /api/leave-requests — file a leave request (AFC-1058 cutover over
 * AFC-930, ADR-0012; forward-port onto the main route path).
 *
 * The requester is the session user, stamped server-side and never trusted
 * from the client. No day count is accepted either: used/remaining compute
 * via workingDaysBetween. `requester_person` optionally links the person
 * register row the leave is for (HR filing on behalf — verified
 * route-side, NULL for self-filed rows). Branch resolves at write time
 * from the scope default unless the filer names an in-scope branch
 * (0044 choice-8). The route writes the `created` audit row.
 */
export default defineEventHandler(async (event) => {
  const scope = await getPortalScope(event)
  requireCan(scope, COLLECTIONS.leaveRequests, 'create')

  const parsed = leaveRequestFormSchema.safeParse(await readBody(event))
  if (!parsed.success) throwValidation(parsed.error)
  const form = parsed.data
  if (form.end_date < form.start_date) {
    throw createError({
      statusCode: 400,
      statusMessage: 'The end date cannot come before the start date',
      data: {
        code: 'validation_error',
        fields: { end_date: 'Must not precede start date' },
      },
    })
  }
  const branch = resolveBranch(scope, form.branch)
  if (!branch) {
    throw createError({
      statusCode: 400,
      statusMessage: 'No branch in scope: area staff name the branch the request belongs to',
      data: { code: 'branch_out_of_scope', fields: { branch: 'Required' } },
    })
  }

  if (form.requester_person) {
    await findScopedItem(event, scope, COLLECTIONS.people, form.requester_person, {
      fields: ['id'],
    })
  }

  const parent = await listItems<Record<string, unknown>>(event, scope, 'branches', {
    filter: { id: { _eq: branch } },
    fields: ['zone'],
    limit: 1,
  })
  const rawZone = parent.data[0]?.zone
  const zone = typeof rawZone === 'string' && rawZone.length > 0 ? rawZone : null

  const now = new Date().toISOString()
  const created = await createItem<Record<string, unknown>>(
    event,
    scope,
    COLLECTIONS.leaveRequests,
    {
      requester_user: scope.session.user.id,
      requester_person: form.requester_person ?? null,
      branch,
      zone,
      start_date: form.start_date,
      end_date: form.end_date,
      leave_type: form.leave_type,
      reason: form.reason,
      status: 'pending',
      created_by: scope.session.user.id,
    },
  )
  await writeOfficeAudit(event, scope, COLLECTIONS.leaveRequestEvents, {
    leave_request: created.id,
    event_type: 'created',
    detail: 'Request filed',
    actor_user: scope.session.user.id,
    created_at: now,
  })
  logScopedQuery(scope, 'leave-requests.create', { id: String(created.id) })
  return { data: { ...created, id: String(created.id) } }
})
