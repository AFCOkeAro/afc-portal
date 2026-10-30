import { can, getPortalScope } from '../../utils/portal'
import { checkCrossBranchVisit } from '../../utils/member-check'

/**
 * GET /api/visitors/member-check?phone=&email=&branch= (AFC-907).
 *
 * Live probe for the intake form and the visitor detail page: does this
 * contact match a person record in a DIFFERENT branch (a member visiting
 * for the first time)? Returns a boolean plus the other branch's display
 * name only -- never person ids, names or contact values. The create/update
 * routes stamp the same answer; this endpoint previews it.
 */
export default defineEventHandler(async (event) => {
  const scope = await getPortalScope(event)
  if (!can(scope, 'visitors', 'read') && !can(scope, 'visitors', 'create')) {
    throw createError({
      statusCode: 403,
      statusMessage: 'Visitors intake is required for the member check',
      data: { code: 'forbidden' },
    })
  }

  const query = getQuery(event)
  const phone = typeof query.phone === 'string' ? query.phone : null
  const email = typeof query.email === 'string' ? query.email : null
  const branch =
    typeof query.branch === 'string' && query.branch !== '' ? query.branch : null

  const result = await checkCrossBranchVisit(event, branch, phone, email)
  return {
    data: {
      is_cross_branch: result.isCrossBranch,
      branch_id: result.branchId,
      branch_name: result.branchName,
    },
  }
})
