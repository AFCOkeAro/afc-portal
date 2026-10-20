import type { CalendarItem } from '@afc/shared'
import {
  celebrationFeedFilters,
  celebrationsToCalendarItems,
  collectCelebrations,
} from '../../utils/celebration-feed'
import { getPortalScope, requireCan } from '../../utils/portal'

/**
 * GET /api/celebrations/calendar?date_from=&date_to=&branch=&zone=&type=&visibility=
 *
 * Celebration contribution to the unified calendar (US-U3, via the shared
 * `combineCalendarFeed` helper in office-feed). Recurring greetings project
 * one occurrence per matching month/day inside the window; one-off
 * shout-outs appear on their event_date. Only in-scope celebrations ever
 * enter: the contribution reads the same scoped collector as the feed, so
 * the calendar cannot show what the feed would hide. Only approved and
 * published rows contribute -- drafts are not calendar facts yet.
 */
export default defineEventHandler(async (event): Promise<{ data: CalendarItem[] }> => {
  const scope = await getPortalScope(event)
  requireCan(scope, 'celebrations', 'read')

  const filters = celebrationFeedFilters(event)
  const today = new Date().toISOString().slice(0, 10)
  const from = filters.date_from ?? today
  const to = filters.date_to ?? today

  // The calendar reads every status and narrows to approved/published
  // itself: a status query param selects the feed, not the calendar.
  // Month/day and the date range are read as the window, not as the
  // collector's recurring narrowing -- projection happens in
  // celebrationsToCalendarItems below.
  const { rows } = await collectCelebrations(event, scope, {
    ...filters,
    status: null,
    month: null,
    day: null,
    date_from: null,
    date_to: null,
    page: 1,
    limit: 200,
  })

  const contributing = rows.filter(
    (row) => row.status === 'approved' || row.status === 'published',
  )

  return { data: celebrationsToCalendarItems(contributing, { from, to }) }
})
