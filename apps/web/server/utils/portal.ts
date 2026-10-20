import type { H3Event } from 'h3'
import type { AuthSession, PermissionAction, StaffRole } from '@afc/shared'
import { grantsForRole, hiddenFieldsForRole } from '@afc/shared/role-matrix'
import { directusFetch } from './directus'
import { STUB_ACCESS_TOKEN, requireSession } from './session'

/**
 * Branch-scoped access helpers for the staff-facing portal routes.
 *
 * The Directus policy is still the only authoritative control (data-model §9).
 * These helpers repeat the scope in the query so a route returns the right rows
 * even while the staging project has no policy installed yet, and so the UI can
 * be exercised end-to-end before the policy swap. The `hiddenFields` list comes
 * from the shared role matrix for the same reason: it is the UI contract, not a
 * substitute for the policy.
 */

export interface PortalScope {
  session: AuthSession
  role: StaffRole
  isArea: boolean
  branchIds: string[]
  hiddenFields: Record<string, string[]>
  token: string
}

type Filter = Record<string, unknown>

export async function getPortalScope(event: H3Event): Promise<PortalScope> {
  const { session, accessToken } = await requireSession(event)
  const role = session.user.staffRole
  const isArea = role === 'area_admin' || role === 'super_admin'
  const branchIds = [
    ...new Set(
      [session.user.branchId, ...session.user.branchIds].filter(
        (value): value is string => typeof value === 'string' && value.length > 0,
      ),
    ),
  ]

  // data-model §9 rule 5: no branch and no area grant means the account sees
  // nothing. Failing here with an explanation is safer than returning an empty
  // list that looks like a working page.
  if (!isArea && branchIds.length === 0) {
    throw createError({
      statusCode: 403,
      statusMessage: 'Your account has no branch scope',
      data: { code: 'unscoped_session' },
    })
  }

  const config = useRuntimeConfig(event)
  const token =
    accessToken && accessToken !== STUB_ACCESS_TOKEN
      ? accessToken
      : String(config.directusServerToken ?? '')
  if (!token) {
    throw createError({
      statusCode: 503,
      statusMessage: 'No Directus token is configured for portal reads',
      data: { code: 'directus_not_configured' },
    })
  }

  return {
    session,
    role,
    isArea,
    branchIds,
    hiddenFields: hiddenFieldsForRole(role),
    token,
  }
}

export function can(
  scope: PortalScope,
  collection: string,
  action: PermissionAction,
): boolean {
  return grantsForRole(scope.role).some(
    (grant) => grant.collection === collection && grant.action === action,
  )
}

export function requireCan(
  scope: PortalScope,
  collection: string,
  action: PermissionAction,
): void {
  if (can(scope, collection, action)) return
  throw createError({
    statusCode: 403,
    statusMessage: `Your role cannot ${action} ${collection}`,
    data: { code: 'forbidden' },
  })
}

/**
 * Reject a branch outside the caller's scope, and default a branch user to their
 * own branch. Area staff may leave `branch` unset for area-wide rows.
 */
export function resolveBranch(
  scope: PortalScope,
  requested: string | null | undefined,
  options: { allowAreaWide?: boolean } = {},
): string | null {
  if (requested) {
    if (!scope.isArea && !scope.branchIds.includes(requested)) {
      throw createError({
        statusCode: 403,
        statusMessage: 'That branch is outside your scope',
        data: { code: 'branch_out_of_scope' },
      })
    }
    return requested
  }
  if (scope.isArea) {
    if (options.allowAreaWide) return null
    return null
  }
  return scope.branchIds[0] ?? null
}

export function scopeFilter(scope: PortalScope, field = 'branch'): Filter {
  if (scope.isArea) return {}
  return { [field]: { _in: scope.branchIds } }
}

/** Events may be area-wide (branch is null), so a branch user still sees those. */
export function eventScopeFilter(scope: PortalScope): Filter {
  if (scope.isArea) return {}
  return {
    _or: [{ branch: { _in: scope.branchIds } }, { branch: { _null: true } }],
  }
}

export function mergeFilters(...filters: Array<Filter | undefined>): Filter | undefined {
  const active = filters.filter((filter): filter is Filter =>
    Boolean(filter && Object.keys(filter).length > 0),
  )
  if (active.length === 0) return undefined
  if (active.length === 1) return active[0]
  return { _and: active }
}

export function isHidden(scope: PortalScope, collection: string, field: string): boolean {
  return (scope.hiddenFields[collection] ?? []).includes(field)
}

export function visibleFields(
  scope: PortalScope,
  collection: string,
  fields: string[],
): string[] {
  const hidden = new Set(scope.hiddenFields[collection] ?? [])
  return fields.filter((field) => !hidden.has(field))
}

export function stripHidden<T extends Record<string, unknown>>(
  scope: PortalScope,
  collection: string,
  row: T,
): T {
  const hidden = new Set(scope.hiddenFields[collection] ?? [])
  if (hidden.size === 0) return row
  return Object.fromEntries(
    Object.entries(row).filter(([field]) => !hidden.has(field)),
  ) as T
}

export function stripHiddenMany<T extends Record<string, unknown>>(
  scope: PortalScope,
  collection: string,
  rows: T[],
): T[] {
  return rows.map((row) => stripHidden(scope, collection, row))
}

export interface ListOptions {
  filter?: Filter
  fields?: string[]
  sort?: string
  page?: number
  limit?: number
  search?: string
}

export interface ListResult<T> {
  data: T[]
  meta: { total: number; page: number; limit: number }
}

export async function listItems<T>(
  event: H3Event,
  scope: PortalScope,
  collection: string,
  options: ListOptions = {},
): Promise<ListResult<T>> {
  const page = options.page ?? 1
  const limit = options.limit ?? 25
  const query: Record<string, unknown> = {
    limit,
    page,
    meta: 'filter_count',
  }
  if (options.fields?.length) query.fields = options.fields.join(',')
  if (options.sort) query.sort = options.sort
  if (options.search) query.search = options.search
  if (options.filter && Object.keys(options.filter).length > 0) {
    query.filter = options.filter
  }

  const response = await directusFetch<{
    data: T[]
    meta?: { filter_count?: number; total_count?: number }
  }>(event, `/items/${collection}`, { accessToken: scope.token, query })

  const total =
    response.meta?.filter_count ?? response.meta?.total_count ?? response.data.length
  return { data: response.data, meta: { total, page, limit } }
}

export async function findScopedItem<T>(
  event: H3Event,
  scope: PortalScope,
  collection: string,
  id: string,
  options: { fields?: string[]; scope?: Filter } = {},
): Promise<T> {
  const filter = mergeFilters({ id: { _eq: id } }, options.scope ?? scopeFilter(scope))
  const result = await listItems<T>(event, scope, collection, {
    filter,
    fields: options.fields,
    limit: 1,
  })
  const row = result.data[0]
  if (!row) {
    throw createError({
      statusCode: 404,
      statusMessage: 'That record was not found in your scope',
      data: { code: 'not_found' },
    })
  }
  return row
}

export async function createItem<T>(
  event: H3Event,
  scope: PortalScope,
  collection: string,
  body: Record<string, unknown>,
): Promise<T> {
  const response = await directusFetch<{ data: T }>(event, `/items/${collection}`, {
    method: 'POST',
    accessToken: scope.token,
    body,
  })
  return response.data
}

export async function updateItem<T>(
  event: H3Event,
  scope: PortalScope,
  collection: string,
  id: string,
  body: Record<string, unknown>,
): Promise<T> {
  const response = await directusFetch<{ data: T }>(event, `/items/${collection}/${id}`, {
    method: 'PATCH',
    accessToken: scope.token,
    body,
  })
  return response.data
}

export async function countItems(
  event: H3Event,
  scope: PortalScope,
  collection: string,
  filter?: Filter,
): Promise<number> {
  const result = await listItems<unknown>(event, scope, collection, {
    filter,
    fields: ['id'],
    limit: 1,
  })
  return result.meta.total
}

export async function branchNames(
  event: H3Event,
  scope: PortalScope,
): Promise<Map<string, string>> {
  const response = await directusFetch<{
    data: Array<{ id: string | number; name: string; code: string }>
  }>(event, '/items/branches', {
    accessToken: scope.token,
    query: { limit: -1, fields: 'id,name,code', sort: 'sort,name' },
  })
  return new Map(response.data.map((branch) => [String(branch.id), branch.name]))
}

export function ageFromDob(dateOfBirth: string | null | undefined): number | null {
  if (!dateOfBirth) return null
  const born = new Date(`${dateOfBirth}T00:00:00Z`)
  if (Number.isNaN(born.getTime())) return null
  const today = new Date()
  let age = today.getUTCFullYear() - born.getUTCFullYear()
  const beforeBirthday =
    today.getUTCMonth() < born.getUTCMonth() ||
    (today.getUTCMonth() === born.getUTCMonth() && today.getUTCDate() < born.getUTCDate())
  if (beforeBirthday) age -= 1
  return age
}

export function fullName(
  first: string | null | undefined,
  last: string | null | undefined,
  preferred?: string | null,
): string {
  const base = [first, last].filter(Boolean).join(' ').trim()
  return preferred ? `${preferred} (${base})` : base || 'Unnamed'
}

export function csvEscape(value: unknown): string {
  const text = value === null || value === undefined ? '' : String(value)
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

export function csvResponse(event: H3Event, filename: string, rows: string[][]): string {
  setHeader(event, 'Content-Type', 'text/csv; charset=utf-8')
  setHeader(event, 'Content-Disposition', `attachment; filename="${filename}"`)
  return rows.map((row) => row.map(csvEscape).join(',')).join('\n')
}

export function throwValidation(
  error: { issues: Array<{ path: (string | number | symbol)[]; message: string }> },
  message = 'Some fields need attention',
): never {
  const fields: Record<string, string> = {}
  for (const issue of error.issues) {
    const key = issue.path.map(String).join('.')
    if (key && !fields[key]) fields[key] = issue.message
  }
  throw createError({
    statusCode: 400,
    statusMessage: message,
    data: { code: 'validation_error', fields },
  })
}
