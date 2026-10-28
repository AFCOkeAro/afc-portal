import { outreachLocationFormSchema } from '@afc/shared'
import {
  createItem,
  getPortalScope,
  listItems,
  requireCan,
  resolveBranch,
  throwStoreUnavailable,
  throwValidation,
} from '../../utils/portal'

/**
 * POST /api/outreach-locations — add a mission field (AFC-841).
 * Branch/zone stamp from the resolved branch (0044 choice-8: the route
 * owns scope, no trigger backstop).
 */
export default defineEventHandler(async (event) => {
  const scope = await getPortalScope(event)
  requireCan(scope, 'outreach_locations', 'create')

  try {
    const parsed = outreachLocationFormSchema.safeParse(await readBody(event))
    if (!parsed.success) throwValidation(parsed.error)
    const form = parsed.data
    const branch = resolveBranch(scope, form.branch)
    // Zone resolves from the branch row at write time (expenses.post
    // precedent); never taken from the client.
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

    const created = await createItem<Record<string, unknown>>(
      event,
      scope,
      'outreach_locations',
      {
        branch: branch ?? null,
        zone,
        name: form.name,
        category: form.category,
        address: form.address ?? null,
        ownership: form.ownership,
        contact_name: form.contact_name ?? null,
        contact_phone: form.contact_phone ?? null,
        visiting_days: form.visiting_days ?? null,
        notes: form.notes ?? null,
        created_by: scope.session.user.id,
      },
    )
    return { data: { ...created, id: String(created.id) } }
  } catch (error) {
    if ((error as { statusCode?: number })?.statusCode) throw error
    throwStoreUnavailable(error, 'outreach_store', '0051')
  }
})
