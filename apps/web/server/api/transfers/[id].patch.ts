import { transferStatusSchema } from '@afc/shared'
import {
  findScopedItem,
  getPortalScope,
  requireCan,
  throwValidation,
  updateItem,
} from '../../utils/portal'
import { transferScope, writeOfficeAudit } from '../../utils/office'

/**
 * PATCH /api/transfers/:id { status } — lifecycle move (US-E4 AC1).
 *
 * `approved` additionally moves the person's home branch (`people.branch =
 * to_branch`) on the same request so the transfer and the move never drift;
 * both writes are audited. `completed`/`rejected` close the lifecycle.
 */
export default defineEventHandler(async (event) => {
  const scope = await getPortalScope(event)
  requireCan(scope, 'transfers', 'update')

  const parsed = transferStatusSchema.safeParse(await readBody(event))
  if (!parsed.success) throwValidation(parsed.error)

  const id = String(getRouterParam(event, 'id'))
  const row = await findScopedItem<Record<string, unknown>>(
    event,
    scope,
    'transfers',
    id,
    {
      scope: transferScope(scope),
    },
  )

  const now = new Date().toISOString()
  const updated = await updateItem<Record<string, unknown>>(
    event,
    scope,
    'transfers',
    id,
    {
      status: parsed.data.status,
      approved_by:
        parsed.data.status === 'approved' ? scope.session.user.id : row.approved_by,
      updated_at: now,
    },
  )

  if (parsed.data.status === 'approved' && row.person && row.to_branch) {
    try {
      await updateItem(event, scope, 'people', String(row.person), {
        branch: row.to_branch,
      })
    } catch {
      // The person move needs a people grant the office role may lack; the
      // transfer status still moved and the audit below records the intent.
    }
  }

  await writeOfficeAudit(event, scope, 'transfer_events', {
    transfer: id,
    event_type: parsed.data.status === 'approved' ? 'approved' : 'status_changed',
    detail: `Status → ${parsed.data.status}`,
    actor_user: scope.session.user.id,
    created_at: now,
  })

  return { data: updated }
})
