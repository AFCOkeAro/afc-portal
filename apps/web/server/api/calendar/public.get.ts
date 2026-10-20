import type { H3Event } from 'h3'
import { calendarQuerySchema, combineCalendarFeed } from '@afc/shared'
import type { CalendarItem } from '@afc/shared'
import { directusFetch } from '../../utils/directus'

/**
 * GET /api/calendar/public?date_from=&date_to=&item_type= — session-free
 * public calendar feed (AFC-575).
 *
 * SECURITY LENS, read before changing anything here:
 *
 * 1. NO SESSION. This route never calls `getPortalScope` or `requireSession`:
 *    it answers logged-out visitors. The only credential it holds is the
 *    public-scoped token (`NUXT_DIRECTUS_PUBLIC_TOKEN`), whose Directus
 *    policy is the public role's — never the server token.
 * 2. SERVER-SIDE FILTER, FAIL CLOSED. The `visibility = public AND status =
 *    published` predicate is applied in the Directus query itself, not by
 *    filtering afterwards: rows that fail it are never read. An absent public
 *    token closes the feed with 503 rather than answering openly.
 * 3. ALLOWLISTED FIELDS. The `fields` lists below are the whole row the
 *    route ever sees: id, title/type, date, branch reference, and the two
 *    filter columns. Contact data, descriptions, addresses, guardian and
 *    medical columns are never read, so an over-broad public policy cannot
 *    leak them through this route.
 * 4. STRIPPED RESPONSE. The payload carries title/date/branch-name only —
 *    no hrefs into staff pages, no contact data, no unpublished or
 *    branch-internal rows.
 *
 * Celebrations are included because the model supports the same pair
 * (celebrations.visibility public + status published, migration 0012):
 * publication is an explicit staff decision, and only that decision puts a
 * row here. Person names are never projected — the title falls back to the
 * celebration type label, never to a person display name.
 */
interface PublicCalendarItem {
  id: string
  item_type: 'event' | 'celebration'
  title: string
  date: string
  branch_name: string | null
}

const PUBLIC_EVENT_FIELDS = [
  'id',
  'title',
  'start_at',
  'branch',
  'visibility',
  'status',
].join(',')

const PUBLIC_CELEBRATION_FIELDS = [
  'id',
  'title',
  'type',
  'event_date',
  'is_recurring',
  'branch',
  'visibility',
  'status',
].join(',')

export default defineEventHandler(
  async (event): Promise<{ data: PublicCalendarItem[]; meta: { total: number } }> => {
    const config = useRuntimeConfig(event)
    const publicToken = String(config.directusPublicToken ?? '')
    if (!publicToken) {
      throw createError({
        statusCode: 503,
        statusMessage:
          'NUXT_DIRECTUS_PUBLIC_TOKEN is not configured. The public calendar is closed.',
        data: { code: 'calendar_public_unavailable' },
      })
    }

    const query = getQuery(event)
    const parsed = calendarQuerySchema.safeParse({
      page: 1,
      limit: 200,
      date_from: query.date_from,
      date_to: query.date_to,
      item_type: query.item_type,
    })
    const filters = parsed.success
      ? parsed.data
      : { date_from: undefined, date_to: undefined, item_type: undefined }

    const eventFilter: Record<string, unknown> = {
      visibility: { _eq: 'public' },
      status: { _eq: 'published' },
    }
    if (filters.date_from) eventFilter.start_at = { _gte: filters.date_from }
    if (filters.date_to) {
      eventFilter.start_at = { ...(eventFilter.start_at as object), _lte: `${filters.date_to}T23:59:59.999Z` }
    }
    const celebrationFilter: Record<string, unknown> = {
      visibility: { _eq: 'public' },
      status: { _eq: 'published' },
    }

    const [eventRows, celebrationRows, branchNames] = await Promise.all([
      directusFetch<{ data: Record<string, unknown>[] }>(event, '/items/events', {
        method: 'GET',
        accessToken: publicToken,
        query: { filter: eventFilter, fields: PUBLIC_EVENT_FIELDS, limit: 200, sort: 'start_at' },
      }).then((response) => response.data),
      directusFetch<{ data: Record<string, unknown>[] }>(event, '/items/celebrations', {
        method: 'GET',
        accessToken: publicToken,
        query: {
          filter: celebrationFilter,
          fields: PUBLIC_CELEBRATION_FIELDS,
          limit: 200,
          sort: 'event_date',
        },
      })
        .then((response) => response.data)
        .catch(() => [] as Record<string, unknown>[]),
      loadBranchNames(event, publicToken),
    ])

    const from = filters.date_from ?? '0000-01-01'
    const to = filters.date_to ?? '9999-12-31'

    const feed = combineCalendarFeed(
      {
        event: eventRows.map((row) => ({
          id: String(row.id),
          item_type: 'event' as const,
          title: String(row.title ?? 'Event'),
          date: String(row.start_at ?? '').slice(0, 10),
          starts_at: row.start_at ? String(row.start_at) : null,
          branch: row.branch ? String(row.branch) : null,
          zone: null,
          href: null,
        })),
        celebration: projectCelebrations(celebrationRows, { from, to }),
      },
      { dateFrom: filters.date_from, dateTo: filters.date_to, itemType: filters.item_type },
    )

    const items: PublicCalendarItem[] = feed
      .filter((item) => item.date.length === 10)
      .filter((item) => item.item_type === 'event' || item.item_type === 'celebration')
      .map((item) => ({
        id: item.id,
        item_type: item.item_type as 'event' | 'celebration',
        title: item.title,
        date: item.date,
        branch_name: item.branch ? (branchNames.get(item.branch) ?? null) : null,
      }))
    return { data: items, meta: { total: items.length } }
  },
)

/**
 * Celebration projection for the public feed. One-off greetings appear on
 * their event_date when it falls inside the window; recurring greetings
 * project one occurrence per year inside the window (the staff-side
 * `celebrationsToCalendarItems` shape, minus person names, zones and hrefs).
 */
function projectCelebrations(
  rows: Record<string, unknown>[],
  window: { from: string; to: string },
): CalendarItem[] {
  const items: CalendarItem[] = []
  for (const row of rows) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(row.event_date ?? ''))
    if (!match) continue
    const title =
      typeof row.title === 'string' && row.title.trim().length > 0
        ? row.title
        : String(row.type ?? 'celebration').replace(/_/g, ' ')
    const branch = row.branch ? String(row.branch) : null
    if (row.is_recurring === true) {
      const [, , month, day] = match
      const fromYear = Number(window.from.slice(0, 4))
      const toYear = Number(window.to.slice(0, 4))
      for (let year = fromYear; year <= toYear; year += 1) {
        const occurrence = `${year}-${month}-${day}`
        if (occurrence < window.from || occurrence > window.to) continue
        items.push({
          id: String(row.id),
          item_type: 'celebration',
          title,
          date: occurrence,
          starts_at: null,
          branch,
          zone: null,
          href: null,
        })
      }
    } else {
      const date = String(row.event_date)
      if (date < window.from || date > window.to) continue
      items.push({
        id: String(row.id),
        item_type: 'celebration',
        title,
        date,
        starts_at: null,
        branch,
        zone: null,
        href: null,
      })
    }
  }
  return items
}

/**
 * Branch id → name for the public payload. A failure resolves to an empty
 * map (names render as unknown) rather than failing the feed: the names are
 * display text, and refusing the whole feed over them would be a worse
 * failure than a missing label. Never throws.
 */
async function loadBranchNames(
  event: H3Event,
  publicToken: string,
): Promise<Map<string, string>> {
  try {
    const response = await directusFetch<{ data: Array<{ id: string | number; name: string }> }>(
      event,
      '/items/branches',
      {
        method: 'GET',
        accessToken: publicToken,
        query: { fields: 'id,name', limit: -1 },
      },
    )
    return new Map(response.data.map((row) => [String(row.id), row.name]))
  } catch {
    return new Map()
  }
}
