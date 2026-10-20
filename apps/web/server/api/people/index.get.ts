import type { PersonRow } from '../../../types/portal'
import {
  ageFromDob,
  branchNames,
  getPortalScope,
  isHidden,
  listItems,
  mergeFilters,
  requireCan,
  scopeFilter,
  stripHidden,
  visibleFields,
} from '../../utils/portal'

const PERSON_FIELDS = [
  'id',
  'first_name',
  'last_name',
  'preferred_name',
  'other_names',
  'gender',
  'date_of_birth',
  'is_minor',
  'phone',
  'email',
  'address',
  'household',
  'branch',
  'membership_status',
  'member_since',
  'guardian',
  'consent_data',
  'consent_media',
  'consent_signed_at',
  'status',
  'notes',
  'safeguarding_flag',
]

export default defineEventHandler(async (event) => {
  const scope = await getPortalScope(event)
  requireCan(scope, 'people', 'read')

  const query = getQuery(event)
  const page = Math.max(1, Number(query.page) || 1)
  const limit = Math.min(200, Math.max(1, Number(query.limit) || 25))
  const search =
    typeof query.search === 'string' ? query.search.trim().slice(0, 120) : undefined
  const branch = typeof query.branch === 'string' ? query.branch : undefined
  const membershipStatus =
    typeof query.membership_status === 'string' ? query.membership_status : undefined
  const status =
    query.status === 'all'
      ? undefined
      : query.status === 'archived'
        ? 'archived'
        : 'active'

  const sort =
    query.sort === 'recent'
      ? 'member_since:desc,last_name'
      : query.sort === 'first_name'
        ? 'first_name,last_name'
        : 'last_name,first_name'

  const result = await listItems<PersonRow>(event, scope, 'people', {
    filter: mergeFilters(
      status ? { status: { _eq: status } } : undefined,
      membershipStatus ? { membership_status: { _eq: membershipStatus } } : undefined,
      branch ? { branch: { _eq: branch } } : undefined,
      scopeFilter(scope),
    ),
    fields: visibleFields(scope, 'people', PERSON_FIELDS),
    sort,
    page,
    limit,
    search: search || undefined,
  })

  const names = await branchNames(event, scope)
  const rows = result.data.map((row) => {
    const record = row as unknown as Record<string, unknown>
    return stripHidden(scope, 'people', {
      ...record,
      id: String(record.id),
      branch_name: record.branch
        ? (names.get(String(record.branch)) ?? null)
        : null,
      age: isHidden(scope, 'people', 'date_of_birth')
        ? null
        : ageFromDob(record.date_of_birth as string | null | undefined),
    }) as unknown as PersonRow
  })

  return { data: rows, meta: result.meta }
})
