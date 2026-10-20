import { transferFormSchema } from '@afc/shared'
import {
  createItem,
  getPortalScope,
  requireCan,
  scopeZoneIds,
  throwValidation,
} from '../../utils/portal'
import { writeOfficeAudit } from '../../utils/office'

/**
 * POST /api/transfers — record a branch transfer (US-E4 AC1).
 *
 * from_branch/to_branch must both sit inside the caller's scope (area staff
 * may name any branches). The create writes the audit row (`transfer_events`
 * `created`); approving the transfer (PATCH status=approved) moves the
 * person's home branch via a person update on the same request -- audited
 * through both trails.
 */
export default defineEventHandler(async (event) => {
  const scope = await getPortalScope(event)
  requireCan(scope, 'transfers', 'create')

  const parsed = transferFormSchema.safeParse(await readBody(event))
  if (!parsed.success) throwValidation(parsed.error)
  const form = parsed.data

  if (!scope.isArea) {
    for (const branch of [form.from_branch, form.to_branch]) {
      if (!scope.branchIds.includes(branch)) {
        throw createError({
          statusCode: 403,
          statusMessage: 'That branch is outside your scope',
          data: { code: 'branch_out_of_scope' },
        })
      }
    }
  }

  const zones = await scopeZoneIds(event, scope)
  const now = new Date().toISOString()
  const created = await createItem<Record<string, unknown>>(event, scope, 'transfers', {
    person: form.person,
    from_branch: form.from_branch,
    to_branch: form.to_branch,
    zone: zones[0] ?? null,
    reason: form.reason ?? null,
    request_date: now.slice(0, 10),
    effective_date: form.effective_date ?? null,
    status: 'requested',
    requested_by: scope.session.user.id,
    approved_by: null,
    notes: form.notes ?? null,
    created_at: now,
    updated_at: now,
  })

  await writeOfficeAudit(event, scope, 'transfer_events', {
    transfer: String(created.id),
    event_type: 'created',
    detail: `Transfer requested: ${form.from_branch} → ${form.to_branch}`,
    actor_user: scope.session.user.id,
    created_at: now,
  })

  return { data: { ...created, id: String(created.id) } }
})
