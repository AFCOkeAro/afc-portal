import type { H3Event } from 'h3'
import { directusFetch } from '../../../utils/directus'

/**
 * GET /api/public/events/:id — signed-out programme detail (AFC-871 slice 2).
 *
 * SECURITY LENS, read before changing anything here:
 *
 * 1. NO SESSION. This route never calls `getPortalScope` or `requireSession`:
 *    it answers logged-out visitors. The only credential is the public-scoped
 *    token (`NUXT_DIRECTUS_PUBLIC_TOKEN`), never the server token.
 * 2. FEED PREDICATE FIRST, SECTIONS SECOND. The event row is read only when
 *    `visibility = public AND status = published`. Each programme section is
 *    then projected per its own `*_visibility` mark: a section is included
 *    only at exactly `public`. `draft` / `private` / `login` / `custom` all
 *    fail closed (omitted). `custom` has no audience model behind it yet, so
 *    it MUST NOT be served as public or login — recorded debt, not a gap to
 *    fill here.
 * 3. ALLOWLISTED FIELDS. The `fields` list is the whole row this route ever
 *    sees. Contact data, guardian/medical columns, and unpublished rows are
 *    never read, so an over-broad public policy cannot leak them.
 * 4. 404, NOT 403. A non-public / non-published / missing event is a 404
 *    (`event_not_public`) so an anonymous caller is not told whether an
 *    internal event exists. Same shape as /api/register and testimonies.
 */

interface PublicEventRow {
  id: string
  title: string
  summary: string | null
  description: string | null
  event_type: string
  start_at: string
  end_at: string
  location: string | null
  address: string | null
  capacity: number | null
  waitlist_enabled: boolean
  registration_opens_at: string | null
  registration_closes_at: string | null
  fee_amount: string | null
  currency: string | null
  requires_guardian_consent: boolean
  collect_medical: boolean
  age_min: number | null
  age_max: number | null
  visibility: string
  status: string
  registration_visibility: string
  speakers_visibility: string
  resources_visibility: string
  schedule_visibility: string
  speakers: Array<Record<string, unknown>>
  resources: Array<Record<string, unknown>>
  schedule: Array<Record<string, unknown>>
  branch: string | null
}

const PUBLIC_DETAIL_FIELDS = [
  'id',
  'title',
  'summary',
  'description',
  'event_type',
  'start_at',
  'end_at',
  'location',
  'address',
  'capacity',
  'waitlist_enabled',
  'registration_opens_at',
  'registration_closes_at',
  'fee_amount',
  'currency',
  'requires_guardian_consent',
  'collect_medical',
  'age_min',
  'age_max',
  'visibility',
  'status',
  'registration_visibility',
  'speakers_visibility',
  'resources_visibility',
  'schedule_visibility',
  'speakers',
  'resources',
  'schedule',
  'branch',
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

export default defineEventHandler(async (event: H3Event) => {
  const config = useRuntimeConfig(event)
  const publicToken = String(config.directusPublicToken ?? '')
  if (!publicToken) {
    throw createError({
      statusCode: 503,
      statusMessage:
        'NUXT_DIRECTUS_PUBLIC_TOKEN is not configured. The public programme page is closed.',
      data: { code: 'event_public_unavailable' },
    })
  }

  const id = getRouterParam(event, 'id')
  if (!id)
    throw createError({ statusCode: 400, statusMessage: 'An event id is required' })

  const row = await directusFetch<{ data: PublicEventRow[] }>(event, '/items/events', {
    method: 'GET',
    accessToken: publicToken,
    query: {
      filter: {
        id: { _eq: id },
        visibility: { _eq: 'public' },
        status: { _eq: 'published' },
      },
      limit: 1,
      fields: PUBLIC_DETAIL_FIELDS,
    },
  }).then((response) => response.data[0] ?? null)

  if (!row) {
    throw createError({
      statusCode: 404,
      statusMessage: 'That event is not published publicly',
      data: { code: 'event_not_public' },
    })
  }

  const branchId = typeof row.branch === 'string' && row.branch !== '' ? row.branch : null
  const branchNames = branchId
    ? await loadBranchNames(event, publicToken)
    : new Map<string, string>()

  // Per-section projection: only `public` serves. Everything else
  // (draft/private/login/custom) fails closed to null — the client renders
  // "not shared publicly" instead of the content.
  const atPublic = (mark: string): boolean => mark === 'public'
  return {
    data: {
      id: row.id,
      title: row.title,
      summary: row.summary,
      description: row.description,
      event_type: row.event_type,
      start_at: row.start_at,
      end_at: row.end_at,
      location: row.location,
      address: row.address,
      capacity: row.capacity,
      waitlist_enabled: row.waitlist_enabled,
      registration_opens_at: row.registration_opens_at,
      registration_closes_at: row.registration_closes_at,
      fee_amount: row.fee_amount,
      currency: row.currency,
      requires_guardian_consent: row.requires_guardian_consent,
      collect_medical: row.collect_medical,
      age_min: row.age_min,
      age_max: row.age_max,
      registration_open: atPublic(row.registration_visibility),
      branch_name: branchId ? (branchNames.get(branchId) ?? null) : null,
      speakers: atPublic(row.speakers_visibility) ? (row.speakers ?? []) : null,
      resources: atPublic(row.resources_visibility) ? (row.resources ?? []) : null,
      schedule: atPublic(row.schedule_visibility) ? (row.schedule ?? []) : null,
      sections: {
        registration: row.registration_visibility,
        speakers: row.speakers_visibility,
        resources: row.resources_visibility,
        schedule: row.schedule_visibility,
      },
    },
  }
})
