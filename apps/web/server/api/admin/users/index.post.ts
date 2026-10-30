import { STAFF_ROLES } from '@afc/shared'
import { requireArea } from '../../../utils/admin-guard'
import { directusFetch } from '../../../utils/directus'
import { directusAdminToken } from '../../../utils/directus-admin'

/**
 * POST /api/admin/users — add a person with a permission level and coverage
 * (AFC-914). Area admins only, mirroring PATCH /api/admin/users/:id.
 *
 * Body: email + name (identity), staff_role (permission level), and coverage
 * (area / zone / branch / AVS location / BSC). Modules need no coverage
 * value: they are derived from the staff role by the role matrix, and the
 * UI previews them read-only. AVS/BSC coverage resolves to the parent
 * branch scope — both collections hang off a branch — so no new register
 * or store is introduced here.
 *
 * Flow: Directus invite (POST /users/invite) then PATCH the invited row
 * with staff_role + scope links. Invite sends the set-password email; this
 * route never accepts, generates, or returns a password. A duplicate email
 * is a 409 naming the existing row instead of a silent update.
 */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

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

function invalid(message: string, fields: Record<string, string>): never {
  throw createError({
    statusCode: 400,
    statusMessage: message,
    data: { code: 'validation_error', fields },
  })
}

async function roleIdByName(
  event: Parameters<typeof directusFetch>[0],
  token: string,
  name: string,
): Promise<string | null> {
  const match = await directusFetch<{ data: Array<{ id: string }> }>(event, '/roles', {
    accessToken: token,
    query: { filter: { name: { _eq: name } }, fields: 'id', limit: 1 },
  })
  return (match.data ?? [])[0]?.id ?? null
}

export default defineEventHandler(async (event) => {
  await requireArea(event)
  const adminToken = await directusAdminToken(event)
  const body = await readBody<Record<string, unknown>>(event)

  const email = asText(body?.email, 254)?.toLowerCase() ?? null
  if (!email || !EMAIL_PATTERN.test(email)) {
    invalid('A valid email address is required', { email: 'Required' })
  }
  const firstName = asText(body?.first_name, 100)
  const lastName = asText(body?.last_name, 100)

  const staffRole = asText(body?.staff_role, 60)
  if (!staffRole) {
    invalid('A staff role is required', { staff_role: 'Required' })
  }
  const builtIn = (STAFF_ROLES as readonly string[]).includes(staffRole)
  const roleName = builtIn ? (BUILT_IN_ROLE_NAMES[staffRole] ?? null) : staffRole
  if (!roleName) {
    invalid(`No Directus role for “${staffRole}”`, { staff_role: 'Unknown role' })
  }
  const roleId = await roleIdByName(event, adminToken, roleName)
  if (!roleId) {
    invalid(
      builtIn
        ? `Seeded Directus role “${roleName}” is missing`
        : `No Directus role named “${staffRole}” — create it on the Roles tab first`,
      { staff_role: 'Unknown role' },
    )
  }

  const existing = await directusFetch<{ data: Array<{ id: string }> }>(event, '/users', {
    accessToken: adminToken,
    query: { filter: { email: { _eq: email } }, fields: 'id', limit: 1 },
  })
  if ((existing.data ?? []).length > 0) {
    throw createError({
      statusCode: 409,
      statusMessage: 'A user with that email already exists — use Edit instead',
      data: { code: 'already_exists', fields: { email: 'Already registered' } },
    })
  }

  // Coverage: explicit branch/zone/area UUIDs, plus AVS/BSC pickers that
  // resolve to their parent branch. Every candidate branch must agree.
  const branchCandidates: string[] = []
  const explicitBranch = asUuid(body?.branch)
  if (explicitBranch) branchCandidates.push(explicitBranch)

  const avsLocation = asUuid(body?.avs_location)
  if (avsLocation) {
    const row = await directusFetch<{ data: { branch: string | null } }>(
      event,
      `/items/outreach_locations/${avsLocation}`,
      { accessToken: adminToken, query: { fields: 'branch' } },
    )
    if (!row.data?.branch) {
      invalid('That AVS location has no branch link', { avs_location: 'No branch' })
    }
    branchCandidates.push(row.data.branch)
  }

  const bsc = asUuid(body?.bsc)
  let bscZone: string | null = null
  if (bsc) {
    const row = await directusFetch<{
      data: { parent_branch: string | null; zone: string | null }
    }>(event, `/items/bscs/${bsc}`, {
      accessToken: adminToken,
      query: { fields: 'parent_branch,zone' },
    })
    if (!row.data?.parent_branch) {
      invalid('That BSC has no parent branch', { bsc: 'No branch' })
    }
    branchCandidates.push(row.data.parent_branch)
    bscZone = row.data.zone
  }

  const uniqueBranches = [...new Set(branchCandidates)]
  if (uniqueBranches.length > 1) {
    invalid('Coverage branches disagree — pick one branch', { branch: 'Conflict' })
  }
  const branch = uniqueBranches[0] ?? null

  let zone = asUuid(body?.zone) ?? bscZone
  let area = asUuid(body?.area)
  if (branch) {
    const row = await directusFetch<{
      data: { zone: string | null; area: string | null }
    }>(event, `/items/branches/${branch}`, {
      accessToken: adminToken,
      query: { fields: 'zone,area' },
    })
    zone = zone ?? row.data?.zone ?? null
    area = area ?? row.data?.area ?? null
  } else if (zone && !area) {
    const row = await directusFetch<{ data: { area: string | null } }>(
      event,
      `/items/zones/${zone}`,
      { accessToken: adminToken, query: { fields: 'area' } },
    )
    area = row.data?.area ?? null
  }

  // Invite first so Directus sends the set-password email; this route never
  // sees a password. Then stamp identity + role + scope on the invited row.
  await directusFetch(event, '/users/invite', {
    accessToken: adminToken,
    method: 'POST',
    body: { email, role: roleId },
  })
  const invited = await directusFetch<{ data: Array<{ id: string }> }>(event, '/users', {
    accessToken: adminToken,
    query: { filter: { email: { _eq: email } }, fields: 'id', limit: 1 },
  })
  const id = (invited.data ?? [])[0]?.id ?? null
  if (!id) {
    throw createError({
      statusCode: 502,
      statusMessage: 'Invite sent but the user row was not found',
      data: { code: 'invite_lookup_failed' },
    })
  }
  await directusFetch(event, `/users/${id}`, {
    accessToken: adminToken,
    method: 'PATCH',
    body: {
      first_name: firstName,
      last_name: lastName,
      staff_role: staffRole,
      role: roleId,
      branch,
      branch_ids: branch ? [branch] : [],
      zone,
      zone_ids: zone ? [zone] : [],
      area,
    },
  })
  return { data: { id, email } }
})
