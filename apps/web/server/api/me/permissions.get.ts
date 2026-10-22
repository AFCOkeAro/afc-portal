import type { CapabilitiesPayload, Grant } from '@afc/shared'
import { readableCollections, sortGrants, writableCollections } from '@afc/shared'
import { capabilitiesForRole } from '@afc/shared/role-matrix'
import { requireSession } from '../../utils/session'
import { customGrantsForRole, isBuiltInRole } from '../../utils/custom-grants'

/**
 * GET /api/me/permissions
 *
 * The capabilities endpoint data-model §13 rule 7 asks for: the UI is driven from
 * this rather than from a role name, so a change of governance layer does not
 * become a UI rewrite.
 *
 * The payload contains grants and the fields the UI must hide. It is
 * navigation, not authorisation. data-model §9 is explicit that the Directus
 * policy is the only authoritative control, and the CI permission tests
 * (repo-plan §4 step 5) are what prove it.
 *
 * Until Directus exists, the grants come from the transcription of the §10
 * matrix in `@afc/shared/role-matrix` rather than from the policy that will
 * implement it. That transcription is a translation of a table, not a control:
 * treat the two as agreeing, not as the second being derived from the first.
 */
export default defineEventHandler(async (event): Promise<CapabilitiesPayload> => {
  const { session } = await requireSession(event)

  const payload = capabilitiesForRole({
    staffRole: session.user.staffRole,
    branchId: session.user.branchId,
    zoneId: session.user.zoneId ?? null,
    zoneIds: session.user.zoneIds ?? [],
  })

  // Custom roles (AFC-669) resolve through Directus permissions rather than
  // the code matrix, so the sidebar sees the same grants the route gate
  // enforces. Fail-closed: a resolution failure keeps the empty payload.
  if (!isBuiltInRole(String(session.user.staffRole))) {
    const custom: Grant[] = await customGrantsForRole(
      event,
      String(session.user.staffRole),
    ).catch(() => [] as Grant[])
    if (custom.length > 0) {
      const grants = sortGrants(custom)
      return {
        grants,
        readable: readableCollections(grants),
        writable: writableCollections(grants),
        hiddenFields: {},
        scoped:
          session.user.branchId !== null ||
          (session.user.zoneId ?? null) !== null ||
          (session.user.zoneIds ?? []).length > 0,
      }
    }
  }

  // A session with no branch and no area grant sees nothing (data-model §9
  // rule 5, fail closed). `capabilitiesForRole` already returns an empty grant
  // list for that case; the flag is carried so the shell can say why.
  return payload
})
