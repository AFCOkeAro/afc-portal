import { listQuerySchema } from '@afc/shared'
import {
  branchNames,
  getPortalScope,
  listItems,
  requireCan,
  stripHiddenMany,
  visibleFields,
} from '../../utils/portal'
import { logScopedQuery, officeBranchScope, officeZoneScope } from '../../utils/office'

/**
 * Report columns (AFC-680 scope E). The conducted-marriage facts the
 * report page shows: who (brother/sister), where (branch = church in DB),
 * when (wedding date), and the conducted-marriage record (officiating
 * minister, Bible passage, certificate type + the three file slots).
 */
const REPORT_FIELDS = [
  'id',
  'brother_person',
  'sister_person',
  'branch',
  'zone',
  'stage',
  'wedding_date',
  'officiating_minister',
  'bible_passage',
  'certificate_type',
  'marriage_certificate_file',
  'couple_photo_file',
  'presentation_photo_file',
  'created_at',
]

/** GET /api/marriage-cases/report — all marriages conducted (AFC-680). */
export default defineEventHandler(async (event) => {
  const scope = await getPortalScope(event)
  requireCan(scope, 'marriage_cases', 'read')

  const query = getQuery(event)
  const parsed = listQuerySchema.safeParse({
    page: query.page ?? 1,
    limit: query.limit ?? 25,
    sort: query.sort ?? '-wedding_date',
  })
  const paging = parsed.success
    ? parsed.data
    : { page: 1, limit: 25 as number, sort: '-wedding_date' }
  logScopedQuery(scope, 'marriage-cases.report', {})

  let result: Awaited<ReturnType<typeof listItems<Record<string, unknown>>>>
  try {
    result = await listItems<Record<string, unknown>>(event, scope, 'marriage_cases', {
      filter: {
        stage: { _eq: 'reported' },
        ...officeBranchScope(scope),
        ...officeZoneScope(scope),
      },
      fields: visibleFields(scope, 'marriage_cases', REPORT_FIELDS),
      page: paging.page,
      limit: paging.limit,
      sort: paging.sort,
    })
  } catch (error) {
    if (error && typeof error === 'object' && 'statusCode' in error) throw error
    throw createError({
      statusCode: 503,
      statusMessage: 'The marriage report is unavailable (migration 0035 not applied?)',
      data: { code: 'pending_migration_0035', cause: String(error) },
    })
  }

  // Brother/sister + minister display names (best-effort: a name lookup
  // never fails the report; an unknown id renders as null upstream).
  const personIds = [
    ...new Set(
      result.data
        .flatMap((row) => [
          row.brother_person,
          row.sister_person,
          row.officiating_minister,
        ])
        .filter((value): value is string => typeof value === 'string' && value.length > 0),
    ),
  ]
  const people = new Map<string, string>()
  if (personIds.length > 0) {
    try {
      const response = await listItems<{
        id: string | number
        first_name: string
        last_name: string
        preferred_name: string | null
      }>(event, scope, 'people', {
        filter: { id: { _in: personIds } },
        fields: ['id', 'first_name', 'last_name', 'preferred_name'],
        limit: personIds.length,
      })
      for (const person of response.data) {
        const name = [person.first_name, person.last_name].filter(Boolean).join(' ')
        people.set(String(person.id), person.preferred_name || name || 'Unnamed')
      }
    } catch {
      // Best-effort only; the report stands on the ids.
    }
  }

  let names = new Map<string, string>()
  try {
    names = await branchNames(event, scope)
  } catch {
    // Best-effort only; the report stands on the branch ids.
  }

  const rows = stripHiddenMany(scope, 'marriage_cases', result.data).map((row) => ({
    ...row,
    brother_name: row.brother_person
      ? (people.get(String(row.brother_person)) ?? null)
      : null,
    sister_name: row.sister_person ? (people.get(String(row.sister_person)) ?? null) : null,
    branch_name: row.branch ? (names.get(String(row.branch)) ?? null) : null,
    officiating_minister_name: row.officiating_minister
      ? (people.get(String(row.officiating_minister)) ?? null)
      : null,
  }))

  return { data: rows, meta: result.meta }
})
