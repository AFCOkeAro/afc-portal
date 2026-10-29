import { getPortalScope, requireCan } from '../../../utils/portal'
import { releaseLegalHoldAs } from '../../../utils/legal-holds'

/**
 * POST /api/legal-holds/:id/release — audited legal-hold release (AFC-243).
 *
 * All four of the issue's conditions, in order:
 *
 * 1. The authenticated user is captured at the Directus layer: getPortalScope
 *    requires a session (401 with none) and the releaser below is the session
 *    user's id. The request body is ignored entirely -- a caller-supplied
 *    releaser is the defect AFC-208 revoked, and this route must never read
 *    one.
 * 2. The identity passed to retention.release_hold_as is that authenticated
 *    user, not a uuid the caller supplies.
 * 3. A Directus permission gates it: requireCan on legal_holds update admits
 *    exactly super_admin + area_admin (the DPO seats in the code matrix, fed
 *    by custom Directus grants for custom roles). The Directus policy must
 *    mirror this: update on legal_holds for the corresponding Directus roles.
 * 4. The EXECUTE grant on the function arrived in the same commit as this
 *    route (engine section 6b/7), never alone.
 *
 * There is deliberately no browser affordance yet: releasing a hold decides
 * the fate of a child's record, and the issue routes the surface through
 * UXDesigner before it is built. QA verifies the route in a browser.
 */
export default defineEventHandler(async (event) => {
  const scope = await getPortalScope(event)
  // THE permission gate. Without this call the release path exists without a
  // permission in front of it -- tests/web/legal-holds-release.contract.mjs
  // asserts this line is present, so removing it fails the suite.
  requireCan(scope, 'legal_holds', 'update')

  const id = String(getRouterParam(event, 'id') ?? '')
  const releaser = scope.session.user.id
  await releaseLegalHoldAs(event, id, releaser)
  return { data: { id, releasedBy: releaser } }
})
