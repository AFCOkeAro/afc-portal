import { directusFetch } from '../../../utils/directus'

/**
 * GET /api/public/events/:id — one public event for the landing page
 * (AFC-828 phase 1).
 *
 * SECURITY LENS (the calendar/public.get.ts contract, repeated because it
 * is load-bearing):
 *
 * 1. NO SESSION. This route never calls `getPortalScope` or `requireSession`:
 *    it answers logged-out visitors. The only credential it holds is the
 *    public-scoped token (`NUXT_DIRECTUS_PUBLIC_TOKEN`), whose Directus
 *    policy is the public role's — never the server token.
 * 2. SERVER-SIDE FILTER, FAIL CLOSED. `visibility = public AND status =
 *    published` is applied in the Directus query itself, together with the
 *    id: a non-public, unpublished, closed or cancelled event 404s exactly
 *    like a missing one. An absent public token closes the route with 503.
 * 3. ALLOWLISTED FIELDS. `id, title, summary, event_type, start_at, end_at,
 *    branch` is the whole row this route ever sees. Contact data,
 *    descriptions beyond the marketing summary, payment and registration
 *    internals are never read, so an over-broad public policy cannot leak
 *    them through this route.
 * 4. STRIPPED RESPONSE. The payload carries display fields + branch name
 *    only — no hrefs into staff pages, no contact data.
 *
 * Later phases (recorded on AFC-828): resources download (needs a backing
 * register), feedback form (needs a feedback entity), registration code +
 * QR display (needs a QR generation choice), blessings (needs the public
 * blessings flow pointed at the event).
 */
interface PublicEvent {
  id: string
  title: string
  summary: string | null
  event_type: string
  start_at: string | null
  end_at: string | null
  branch_name: string | null
}

const PUBLIC_EVENT_FIELDS = [
  'id',
  'title',
  'summary',
  'event_type',
  'start_at',
  'end_at',
  'branch',
  'visibility',
  'status',
].join(',')

async function loadBranchNames(
  event: Parameters<typeof directusFetch>[0],
  publicToken: string,
): Promise<Map<string, string>> {
  const rows = await directusFetch<{ data: Array<{ id: string; name: string }> }>(
    event,
    '/items/branches',
    {
      method: 'GET',
      accessToken: publicToken,
      query: { fields: 'id,name', limit: -1 },
    },
  )
    .then((response) => response.data ?? [])
    .catch(() => [])
  return new Map(rows.map((row) => [String(row.id), String(row.name ?? '')]))
}

export default defineEventHandler(async (event): Promise<{ data: PublicEvent }> => {
  const config = useRuntimeConfig(event)
  const publicToken = String(config.directusPublicToken ?? '')
  if (!publicToken) {
    throw createError({
      statusCode: 503,
      statusMessage:
        'NUXT_DIRECTUS_PUBLIC_TOKEN is not configured. The public event page is closed.',
      data: { code: 'event_public_unavailable' },
    })
  }
  const id = getRouterParam(event, 'id')
  if (!id)
    throw createError({ statusCode: 400, statusMessage: 'An event id is required' })

  const [rows, branchNames] = await Promise.all([
    directusFetch<{ data: Record<string, unknown>[] }>(event, '/items/events', {
      method: 'GET',
      accessToken: publicToken,
      query: {
        filter: {
          id: { _eq: id },
          visibility: { _eq: 'public' },
          status: { _eq: 'published' },
        },
        fields: PUBLIC_EVENT_FIELDS,
        limit: 1,
      },
    }).then((response) => response.data ?? []),
    loadBranchNames(event, publicToken),
  ])
  const row = rows[0]
  if (!row) {
    throw createError({
      statusCode: 404,
      statusMessage: 'That event was not found',
      data: { code: 'not_found' },
    })
  }
  const branch = row.branch ? String(row.branch) : null
  return {
    data: {
      id: String(row.id),
      title: String(row.title ?? 'Event'),
      summary: row.summary ? String(row.summary) : null,
      event_type: String(row.event_type ?? 'service'),
      start_at: row.start_at ? String(row.start_at) : null,
      end_at: row.end_at ? String(row.end_at) : null,
      branch_name: branch ? (branchNames.get(branch) ?? null) : null,
    },
  }
})
