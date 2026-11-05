/**
 * Shared stub behind the AFC-1067 self-approval loader hooks
 * (`leave-decision-self-approval.hooks.mjs`).
 *
 * The leave PATCH route imports `@afc/shared`, `../../utils/portal`, and
 * `../../utils/office`; all three are redirected here so the regression test
 * can execute the real handler with no Nuxt server and no database.
 * Per-test state lives on `globalThis.__leaveSelfApproval`
 * (`{ scope, row, seenPatch, audits }`), installed by the test file before
 * each call. Schemas mirror the real shared shapes for the tested inputs:
 * decision accepts only `approved`/`rejected`, edit accepts the requester
 * fields.
 */

const holder = () => globalThis.__leaveSelfApproval

export const COLLECTIONS = {
  leaveRequests: 'leave_requests',
  leaveRequestEvents: 'leave_request_events',
}

export const leaveDecisionSchema = {
  safeParse: (body) =>
    body && (body.status === 'approved' || body.status === 'rejected')
      ? { success: true, data: { status: body.status } }
      : { success: false, error: new Error('invalid status') },
}

export const leaveEditSchema = {
  safeParse: (body) => {
    const allowed = ['leave_type', 'start_date', 'end_date', 'reason']
    const data = Object.fromEntries(
      Object.entries(body ?? {}).filter(([key]) => allowed.includes(key)),
    )
    return { success: true, data }
  },
}

export async function getPortalScope() {
  return holder().scope
}

export function requireCan() {}

export async function findScopedItem() {
  return holder().row
}

export async function updateItem(_event, _scope, _collection, _id, patch) {
  holder().seenPatch = patch
  return { ...holder().row, ...patch }
}

export function throwValidation(error) {
  const failure = new Error('validation failed')
  failure.cause = error
  throw failure
}

export function officeBranchScope() {
  return {}
}

export function logScopedQuery() {}

export async function writeOfficeAudit(_event, _scope, _collection, row) {
  holder().audits.push(row)
}
