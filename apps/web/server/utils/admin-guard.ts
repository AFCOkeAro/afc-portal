import { getPortalScope, type PortalScope } from './portal'

/**
 * Area-only gate (AFC-669) for the roles/permissions admin surface.
 * Zone, branch and narrower staff manage their own scope; only area and
 * super admins may reshape who can see what.
 */
/**
 * Super-admin-only gate (AFC-836) for built-in role edits. Area admins keep
 * the custom-role paths; only a super admin may reshape a built-in role,
 * and every such write is audited at the route.
 */
export async function requireSuperAdmin(
  event: Parameters<typeof getPortalScope>[0],
): Promise<PortalScope> {
  const scope = await getPortalScope(event)
  if (scope.session.user.staffRole !== 'super_admin') {
    throw createError({
      statusCode: 403,
      statusMessage: 'Built-in roles are managed by a super admin',
      data: { code: 'forbidden' },
    })
  }
  return scope
}

export async function requireArea(
  event: Parameters<typeof getPortalScope>[0],
): Promise<PortalScope> {
  const scope = await getPortalScope(event)
  if (!scope.isArea) {
    throw createError({
      statusCode: 403,
      statusMessage: 'Roles and permissions are managed by area administrators',
      data: { code: 'forbidden' },
    })
  }
  return scope
}
