import { STAFF_ROLES } from '@afc/shared'
import { requireArea } from '../../../utils/admin-guard'
import { directusFetch } from '../../../utils/directus'
import { directusAdminToken } from '../../../utils/directus-admin'

/**
 * PATCH /api/admin/users/:id — assign a role and scope links (AFC-669).
 * Sets the portal `staff_role` (what the code matrix and the custom-grant
 * loader enforce) together with the Directus `role` (what the Directus
 * policy layer enforces on data reads) and the branch / zone / area scope
 * links the server filters rows by. Both layers move together, so a bundle
 * assignment can never grant routes without data or data without routes.
 *
 * Custom staff-role values are accepted only when a Directus role of that
 * exact name exists; built-ins map to the seeded display-name roles.
 */
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const BUILT_IN_ROLE_NAMES: Record<string, string> = {
  super_admin: 'Administrator',
  area_admin: 'Area Admin',
  zone_admin: 'Zone Admin',
  branch_admin: 'Branch Admin',
  department_leader: 'Department Leader',
  volunteer: 'Volunteer',
  none: 'No Access',
}

function asUuid(value: unknown): string | null {
  if (typeof value !== 'string' || value.trim() === '') return null
  return UUID_PATTERN.test(value.trim()) ? value.trim() : null
}

function asText(value: unknown, max: number): string | null {
  if (typeof value !== 'string' || value.trim() === '') return null
  return value.trim().slice(0, max)
}

async function roleIdByName(
  event: Parameters<typeof directusFetch>[0],
  token: string,
  name: string,
): Promise<string | null> {
  const match = await directusFetch<{ data: Array<{ id: string }> }>(
    event,
    '/roles',
    {
      accessToken: token,
      query: { filter: { name: { _eq: name } }, fields: 'id', limit: 1 },
    },
  )
  return (match.data ?? [])[0]?.id ?? null
}

export default defineEventHandler(async (event) => {
  await requireArea(event)
  const adminToken = await directusAdminToken(event)
  const id = String(getRouterParam(event, 'id') ?? '')
  const body = await readBody<Record<string, unknown>>(event)

  const staffRole = asText(body?.staff_role, 60)
  if (!staffRole) {
    throw createError({
      statusCode: 400,
      statusMessage: 'A staff role is required',
      data: { code: 'validation_error', fields: { staff_role: 'Required' } },
    })
  }
  const builtIn = (STAFF_ROLES as readonly string[]).includes(staffRole)
  const roleName = builtIn ? (BUILT_IN_ROLE_NAMES[staffRole] ?? null) : staffRole
  if (!roleName) {
    throw createError({
      statusCode: 400,
      statusMessage: `No Directus role for “${staffRole}”`,
      data: { code: 'validation_error', fields: { staff_role: 'Unknown role' } },
    })
  }
  const roleId = await roleIdByName(event, adminToken, roleName)
  if (!roleId) {
    throw createError({
      statusCode: 400,
      statusMessage: builtIn
        ? `Seeded Directus role “${roleName}” is missing`
        : `No Directus role named “${staffRole}” — create it on the Roles tab first`,
      data: { code: 'validation_error', fields: { staff_role: 'Unknown role' } },
    })
  }

  const branch = asUuid(body?.branch)
  const zone = asUuid(body?.zone)
  const area = asUuid(body?.area)

  await directusFetch(event, `/users/${id}`, {
    accessToken: adminToken,
    method: 'PATCH',
    body: {
      staff_role: staffRole,
      role: roleId,
      branch,
      branch_ids: branch ? [branch] : [],
      zone,
      zone_ids: zone ? [zone] : [],
      area,
    },
  })
  return { data: { updated: true } }
})
