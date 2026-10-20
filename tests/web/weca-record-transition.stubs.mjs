/**
 * Shared stub behind the AFC-501 regression loader hooks
 * (`weca-record-transition.hooks.mjs`).
 *
 * The finance record PATCH route imports `@afc/shared/weca` and
 * `../../../utils/portal`; both are redirected here so the regression test
 * can execute the real handler with no Nuxt server and no database.
 * Per-test state lives on `globalThis.__wecaRecordTransition`
 * (`{ scope, existing, body, seenPatch }`), installed by the test file
 * before each call.
 */

const holder = () => globalThis.__wecaRecordTransition

export async function getPortalScope() {
  return holder().scope
}

export function requireCan() {}

export async function findScopedItem() {
  return holder().existing
}

export async function updateItem(_event, _scope, _collection, _id, patch) {
  holder().seenPatch = patch
  return { ...holder().existing, ...patch }
}

export function resolveBranch(_scope, branch) {
  return branch
}

export function throwValidation(error) {
  const failure = new Error('validation failed')
  failure.cause = error
  throw failure
}

export const financialRecordFormSchema = {
  safeParse: (value) => ({ success: true, data: value }),
}

export function toFinancialRecordPayload(data) {
  return data
}
