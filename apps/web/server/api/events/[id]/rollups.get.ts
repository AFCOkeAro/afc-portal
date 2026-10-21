import { summarizeRegistrations } from '../../../utils/event-registration-completion'
import type { RollupRow } from '../../../utils/event-registration-completion'
import {
  eventScopeFilter,
  findScopedItem,
  getPortalScope,
  listItems,
  requireCan,
  throwStoreUnavailable,
  visibleFields,
} from '../../../utils/portal'

/**
 * Event header rollups (AFC-470 §5): registered / confirmed / attended /
 * revenue, consumed by the detail header.
 *
 * Pure aggregate over the rows the detail route already loads — no summary
 * tables. Same read gates as the CSV export (events read +
 * event_registrations read); field visibility follows the role matrix, and
 * amounts stay hidden for roles outside the finance/branch-admin set the
 * same way the list route hides them.
 */
export default defineEventHandler(async (event) => {
  const scope = await getPortalScope(event)
  requireCan(scope, 'events', 'read')
  requireCan(scope, 'event_registrations', 'read')

  const id = getRouterParam(event, 'id')
  if (!id)
    throw createError({ statusCode: 400, statusMessage: 'An event id is required' })
  // AFC-566: both reads hit 0021 registers. Unreadable store → named
  // error, never a bare 500; deliberate 4xx pass through untouched.
  try {
    await findScopedItem(event, scope, 'events', id, {
      fields: ['id'],
      scope: eventScopeFilter(scope),
    })

    const result = await listItems<RollupRow>(event, scope, 'event_registrations', {
      filter: { event: { _eq: id } },
      fields: visibleFields(scope, 'event_registrations', [
        'registration_status',
        'amount_expected',
        'amount_paid',
      ]),
      limit: -1,
    })
    return { data: summarizeRegistrations(result.data) }
  } catch (error) {
    if ((error as { statusCode?: number })?.statusCode) throw error
    throwStoreUnavailable(error, 'event_store', '0021')
  }
})
