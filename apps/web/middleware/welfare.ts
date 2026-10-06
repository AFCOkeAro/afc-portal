import type { CollectionName, PermissionAction } from '@afc/shared'
import { COLLECTIONS } from '@afc/shared'

/**
 * Welfare guard.
 *
 * The welfare case list and every welfare record behind it are restricted in
 * data-model §10 to branch admins, area admins and super admins: a volunteer has
 * no welfare grant, and a department leader reads only youth cases. The shell
 * therefore does not route a volunteer to `/welfare` at all — the navigation is
 * built from capabilities, so the link is absent — and this guard turns a typed
 * URL into a 403 rather than an empty page.
 *
 * The guard reads a capability, not a role. That is the distinction data-model
 * §13 rule 7 is about: the day the welfare policy is implemented by something
 * other than the §10 matrix, this file does not change.
 */
const WELFARE_READ: readonly [CollectionName, PermissionAction] = [
  COLLECTIONS.welfareCases,
  'read',
]

export default defineNuxtRouteMiddleware(async () => {
  const auth = useAuth()
  const session = await auth.ensureSession()
  if (!session) return navigateTo('/login', { replace: true })

  const permissions = usePermissions()
  const payload = await permissions.load()

  if (!permissions.can(...WELFARE_READ)) {
    return abortNavigation(
      createError({
        statusCode: 403,
        statusMessage: 'You do not have access to welfare cases.',
      }),
    )
  }

  // An unscoped session sees nothing anywhere (data-model §9 rule 5). Reaching
  // here with `scoped: false` means the grants were withheld upstream, so the
  // page must not render an empty shell as though it were simply no data yet.
  if (!payload.scoped) {
    return abortNavigation(
      createError({
        statusCode: 403,
        statusMessage:
          'This account is not assigned to a branch, so no records are visible to it.',
      }),
    )
  }
})
