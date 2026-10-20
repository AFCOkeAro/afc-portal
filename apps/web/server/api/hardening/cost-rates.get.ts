import { getPortalScope, listItems, requireCan } from '../../utils/portal'
import { HARDENING_COLLECTIONS } from '../../utils/hardening'

/**
 * Read the campaign rate card (AFC-486, cost reporting).
 *
 * Staff with a communications read grant see the current per-channel unit
 * costs. A NULL unit_cost means "unset until procurement sets the rate
 * card (I4)" — reported as unset, never as zero.
 */

export default defineEventHandler(async (event) => {
  const scope = await getPortalScope(event)
  requireCan(scope, 'communications', 'read')
  try {
    const result = await listItems(event, scope, HARDENING_COLLECTIONS.costRates, {
      fields: ['channel', 'unit_cost', 'currency', 'effective_from'],
      sort: 'channel',
      limit: 10,
    })
    return { data: result.data, pending_migration_0015: false as const }
  } catch {
    return { data: [], pending_migration_0015: true as const }
  }
})
