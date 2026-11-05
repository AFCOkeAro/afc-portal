import { leaveRequestFormSchema } from '@afc/shared'
import {
  createItem,
  findScopedItem,
  getPortalScope,
  listItems,
  requireCan,
  resolveBranch,
  throwStoreUnavailable,
  throwValidation,
} from '../../utils/portal'

/**
 * POST /api/leave-requests — file a leave request (AFC-842). Days count
 * start..end inclusive and are stamped by the route, never trusted from
 * the client. Branch/zone resolve at write time (0044 choice-8).
 */
export default defineEventHandler(async (event) => {
  const scope = await getPortalScope(event)
  requireCan(scope, 'leave_requests', 'create')

  try {
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

    await findScopedItem(event, scope, 'people', form.person, { fields: ['id'] })

    let zone: string | null = null
    if (branch) {
      const parent = await listItems<Record<string, unknown>>(event, scope, 'branches', {
        filter: { id: { _eq: branch } },
        fields: ['zone'],
        limit: 1,
      })
      const raw = parent.data[0]?.zone
      zone = typeof raw === 'string' && raw.length > 0 ? raw : null
    }

    const start = new Date(`${form.start_date}T00:00:00Z`).getTime()
    const end = new Date(`${form.end_date}T00:00:00Z`).getTime()
    const days = Math.round((end - start) / 86400000) + 1

    const created = await createItem<Record<string, unknown>>(
      event,
      scope,
      'leave_requests',
      {
        branch: branch ?? null,
        zone,
        person: form.person,
        start_date: form.start_date,
        end_date: form.end_date,
        days,
        leave_type: form.leave_type,
        reason: form.reason ?? null,
        status: 'pending',
        created_by: scope.session.user.id,
      },
    )
    return { data: { ...created, id: String(created.id) } }
  } catch (error) {
    if ((error as { statusCode?: number })?.statusCode) throw error
    throwStoreUnavailable(error, 'leave_store', '0052')
  }
})
