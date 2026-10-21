import type { Household } from '@afc/shared'
import {
  ageFromDob,
  branchNames,
  findScopedItem,
  fullName,
  getPortalScope,
  isHidden,
  listItems,
  mergeFilters,
  requireCan,
  scopeFilter,
  stripHiddenMany,
  throwStoreUnavailable,
  visibleFields,
} from '../../utils/portal'

const HOUSEHOLD_FIELDS = [
  'id',
  'name',
  'branch',
  'address',
  'phone',
  'wedding_date',
  'household_head',
  'primary_contact',
  'notes',
]

const MEMBER_FIELDS = [
  'id',
  'first_name',
  'last_name',
  'preferred_name',
  'gender',
  'date_of_birth',
  'is_minor',
  'phone',
  'branch',
  'household_role',
  'membership_status',
  'status',
]

export interface HouseholdMemberRow {
  id: string
  display_name: string
  household_role: string | null
  gender: string
  is_minor: boolean | null
  phone: string | null
  membership_status: string
  status: string
  age: number | null
  is_head: boolean
}

export interface HouseholdDetail extends Household {
  branch_name: string | null
  head_name: string | null
  member_count: number
  members: HouseholdMemberRow[]
}

export default defineEventHandler(async (event): Promise<HouseholdDetail> => {
  const scope = await getPortalScope(event)
  requireCan(scope, 'households', 'read')

  const id = getRouterParam(event, 'id')
  if (!id) {
    throw createError({ statusCode: 400, statusMessage: 'A household id is required' })
  }

  // Branch scope here; the household-head own-only grant
  // (data-model-expansion §11) has no session field in the portal yet
  // (`PortalUser` carries no `household`), so it lives in the Directus
  // policy — the same recorded-not-invented precedent as `zone_admin`.
  // AFC-566: core reads hit the 0020 household register (members resolve
  // via the snapshot-owned people table). Map an unreadable store to the
  // named error, never a bare 500; deliberate 4xx pass through untouched.
  let household: Record<string, unknown>
  let members: { data: Record<string, unknown>[] }
  try {
    household = await findScopedItem<Record<string, unknown>>(
      event,
      scope,
      'households',
      id,
      { fields: HOUSEHOLD_FIELDS },
    )

    members = await listItems<Record<string, unknown>>(event, scope, 'people', {
      filter: mergeFilters({ household: { _eq: id } }, scopeFilter(scope)),
      fields: visibleFields(scope, 'people', MEMBER_FIELDS),
      sort: 'last_name,first_name',
      limit: -1,
    })
  } catch (error) {
    if ((error as { statusCode?: number })?.statusCode) throw error
    throwStoreUnavailable(error, 'household_store', '0020')
  }

  const names = await branchNames(event, scope)
  const headId = household.household_head ? String(household.household_head) : null
  let headName: string | null = null
  if (headId) {
    const head = members.data.find((row) => String(row.id) === headId) as
      Record<string, unknown> | undefined
    if (head) {
      headName = fullName(
        head.first_name as string | null,
        head.last_name as string | null,
        head.preferred_name as string | null | undefined,
      )
    } else {
      const headRow = await listItems<Record<string, unknown>>(event, scope, 'people', {
        filter: mergeFilters({ id: { _eq: headId } }, scopeFilter(scope)),
        fields: ['id', 'first_name', 'last_name', 'preferred_name'],
        limit: 1,
      })
      const found = headRow.data[0]
      if (found) {
        headName = fullName(
          found.first_name as string | null,
          found.last_name as string | null,
          found.preferred_name as string | null | undefined,
        )
      }
    }
  }

  const rows = stripHiddenMany(scope, 'people', members.data).map((row) => ({
    id: String(row.id),
    display_name: fullName(
      row.first_name as string | null,
      row.last_name as string | null,
      row.preferred_name as string | null | undefined,
    ),
    gender: String(row.gender ?? 'unspecified'),
    household_role: (row.household_role as string | null) ?? null,
    is_minor: (row.is_minor as boolean | null) ?? null,
    phone: (row.phone as string | null) ?? null,
    membership_status: String(row.membership_status ?? ''),
    status: String(row.status ?? ''),
    age: isHidden(scope, 'people', 'date_of_birth')
      ? null
      : ageFromDob(row.date_of_birth as string | null | undefined),
    is_head: headId !== null && String(row.id) === headId,
  }))

  return {
    ...(household as unknown as Household),
    id: String(household.id),
    branch_name: household.branch ? (names.get(String(household.branch)) ?? null) : null,
    head_name: headName,
    member_count: rows.length,
    members: rows,
  }
})
