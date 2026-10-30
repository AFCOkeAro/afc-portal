import { visitorFormSchema } from '@afc/shared'
import {
  findScopedItem,
  getPortalScope,
  requireCan,
  resolveBranch,
  throwStoreUnavailable,
  throwValidation,
  updateItem,
} from '../../utils/portal'
import { JOURNEY_FIELDS, validateWelfareOfficer } from '../../utils/visitor-journey'
import { checkCrossBranchVisit } from '../../utils/member-check'

export default defineEventHandler(async (event) => {
  const scope = await getPortalScope(event)
  requireCan(scope, 'visitors', 'update')

  const id = getRouterParam(event, 'id')
  if (!id)
    throw createError({ statusCode: 400, statusMessage: 'A visitor id is required' })
  // AFC-583: every write below hits the 0025 register — map an unreadable
  // store to the named error, never a bare 500. Deliberate 4xx (scope 404s,
  // officer/validation 400s) pass through untouched.
  try {
    await findScopedItem(event, scope, 'visitors', id, { fields: ['id'] })

    const body = (await readBody(event)) as Record<string, unknown>
    const statuses = ['new', 'follow_up', 'converted', 'closed', 'declined']
    if (Object.keys(body).length === 1 && statuses.includes(String(body.status))) {
      const updated = await updateItem<Record<string, unknown>>(
        event,
        scope,
        'visitors',
        id,
        { status: body.status, last_contact_at: new Date().toISOString() },
      )
      return { data: updated }
    }

    const parsed = visitorFormSchema.safeParse(body)
    if (!parsed.success) throwValidation(parsed.error)
    const form = parsed.data
    const branch = resolveBranch(scope, form.branch)

    // Officer assignment is restricted to branch Welfare position holders
    // (AFC-471, data-model-v4 §5). The dedicated assign endpoint shares this
    // check; the edit form cannot bypass it.
    if (form.follow_up_owner) {
      const current = await findScopedItem<Record<string, unknown>>(
        event,
        scope,
        'visitors',
        id,
        { fields: JOURNEY_FIELDS },
      )
      const currentOwner = (current.follow_up_owner as string | null) ?? null
      if (currentOwner !== form.follow_up_owner) {
        await validateWelfareOfficer(
          event,
          scope,
          form.follow_up_owner,
          (current.branch as string | null) ?? branch,
        )
      }
    }

    // Cross-branch flag: recompute only when the contact or branch moved;
    // otherwise the stored stamp stands (no extra read on plain edits).
    const rawBody = body as Record<string, unknown>
    let crossBranch: boolean | null = null
    if ('phone' in rawBody || 'email' in rawBody || 'branch' in rawBody) {
      const current = await findScopedItem<Record<string, unknown>>(
        event,
        scope,
        'visitors',
        id,
        { fields: ['phone', 'email', 'branch'] },
      ).catch(() => null)
      const phone = form.phone ?? (current?.phone as string | null) ?? null
      const email = form.email ?? (current?.email as string | null) ?? null
      const visitBranch = branch ?? (current?.branch as string | null) ?? null
      crossBranch = (
        await checkCrossBranchVisit(event, visitBranch, phone, email).catch(() => ({
          isCrossBranch: false,
        }))
      ).isCrossBranch
    }

    const updated = await updateItem<Record<string, unknown>>(
      event,
      scope,
      'visitors',
      id,
      {
        branch: branch ?? null,
        visitor_first_name: form.visitor_first_name,
        visitor_last_name: form.visitor_last_name,
        email: form.email ?? null,
        phone: form.phone ?? null,
        visit_date: form.visit_date,
        event: form.event ?? null,
        age_group: form.age_group,
        invited_by: form.invited_by ?? null,
        follow_up_owner: form.follow_up_owner ?? null,
        next_follow_up_date: form.next_follow_up_date ?? null,
        notes: form.notes ?? null,
        status: form.status,
        address: form.address ?? null,
        campaign: form.campaign ?? null,
        source: form.source ?? null,
        ...(crossBranch === null ? {} : { is_cross_branch_visit: crossBranch }),
      },
    )
    return { data: updated }
  } catch (error) {
    if ((error as { statusCode?: number })?.statusCode) throw error
    throwStoreUnavailable(error, 'visitor_store', '0025')
  }
})
