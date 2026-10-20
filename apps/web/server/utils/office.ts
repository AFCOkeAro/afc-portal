import type { H3Event } from 'h3'
import { describeScope } from '@afc/shared'
import type { PortalScope } from './portal'
import { createItem, listItems, scopeFilter, zoneScopeFilter } from './portal'

/**
 * Office-bundle scope helpers (AFC-477, data-model-expansion §10).
 *
 * Every office row carries `branch` except transfers (scope = from_branch
 * OR to_branch) and referrals/events deltas (scope = branch copy, nullable).
 * Area staff see everything; everyone else is narrowed to their branches,
 * and zone staff additionally narrow on the `zone` denorm. A session with
 * no scope never reaches here (`getPortalScope` already 403s) -- search and
 * calendar therefore fail closed by construction.
 */

/** Branch predicate for single-branch office rows (marriage/minutes/tasks). */
export function officeBranchScope(scope: PortalScope) {
  return scopeFilter(scope)
}

/** Zone predicate for office rows carrying the `zone` denorm. */
export function officeZoneScope(scope: PortalScope) {
  return zoneScopeFilter(scope)
}

/** Transfers are scoped by either endpoint branch (US-E4). */
export function transferScope(scope: PortalScope) {
  if (scope.isArea) return {}
  return {
    _or: [
      { from_branch: { _in: scope.branchIds } },
      { to_branch: { _in: scope.branchIds } },
    ],
  }
}

/** Announcements: null branch is area-wide and visible to scoped staff. */
export function announcementScope(scope: PortalScope) {
  if (scope.isArea) return {}
  return {
    _or: [{ branch: { _in: scope.branchIds } }, { branch: { _null: true } }],
  }
}

/**
 * Write an audit row for an office domain. The portal route is the writer;
 * the `*_events` table is the trail (welfare_case_events precedent). Never
 * called with client-supplied event types -- each route names its own.
 */
export async function writeOfficeAudit(
  event: H3Event,
  scope: PortalScope,
  collection: string,
  row: Record<string, unknown>,
): Promise<void> {
  try {
    await createItem(event, scope, collection, row)
  } catch (error) {
    // The audit trail must not mask the write it records: log and continue.
    console.error(`office audit write failed (${collection})`, error)
  }
}

/**
 * Observability line (architecture lens: observability). Every calendar and
 * search read logs who queried with what scope, so an audit can tell who
 * saw what across entities.
 */
export function logScopedQuery(
  scope: PortalScope,
  operation: string,
  detail: Record<string, unknown> = {},
): void {
  console.info(
    JSON.stringify({
      operation,
      scope: describeScope({
        role: scope.role,
        branchIds: scope.branchIds,
        zoneIds: scope.zoneIds,
        isArea: scope.isArea,
      }),
      user: scope.session.user.id,
      ...detail,
    }),
  )
}

/**
 * Read one domain for the calendar/search surfaces without failing the
 * whole feed when the domain is absent (event_sessions deferred in 0013,
 * celebrations owned by 463e, coaching in Slice 5). A missing collection
 * contributes zero rows and a notice -- never a forked table.
 */
export async function tryListDomain<T>(
  event: H3Event,
  scope: PortalScope,
  collection: string,
  options: Parameters<typeof listItems>[3] = {},
): Promise<T[]> {
  try {
    const result = await listItems<T>(event, scope, collection, {
      limit: 200,
      ...options,
    })
    return result.data
  } catch {
    return []
  }
}
