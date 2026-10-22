import { getPortalScope, type PortalScope } from './portal'

/**
 * Area-only gate (AFC-669) for the roles/permissions admin surface.
 * Zone, branch and narrower staff manage their own scope; only area and
 * super admins may reshape who can see what.
 */
export async function requireArea(event: Parameters<typeof getPortalScope>[0]): Promise<PortalScope> {
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
