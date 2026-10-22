import { requireArea } from '../../../utils/admin-guard'
import { directusFetch } from '../../../utils/directus'
import { directusAdminToken } from '../../../utils/directus-admin'

/**
 * POST /api/admin/roles — create a custom role with its policy (AFC-669).
 * Creates the Directus role, a matching policy (app access, no admin
 * access) and the access link between them, so the role is immediately
 * usable for custom permissions. The portal picks the role up by name:
 * set a user's staff_role to it and the custom-grant loader enforces the
 * permissions below. Built-in names are refused — those live in code.
 */
const NAME_PATTERN = /^[a-z0-9_]{3,40}$/

export default defineEventHandler(async (event) => {
  await requireArea(event)
  const adminToken = await directusAdminToken(event)
  const body = await readBody<{ name?: unknown; description?: unknown }>(event)
  const name = typeof body?.name === 'string' ? body.name.trim() : ''
  const description =
    typeof body?.description === 'string' ? body.description.trim() : ''
  if (!NAME_PATTERN.test(name)) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Name must be 3-40 lowercase letters, digits or underscores',
      data: { code: 'validation_error', fields: { name } },
    })
  }
  const existing = await directusFetch<{ data: Array<{ id: string }> }>(
    event,
    '/roles',
    {
      accessToken: adminToken,
      query: { filter: { name: { _eq: name } }, fields: 'id', limit: 1 },
    },
  )
  if ((existing.data ?? []).length > 0) {
    throw createError({
      statusCode: 400,
      statusMessage: 'A role with that name already exists',
      data: { code: 'validation_error', fields: { name } },
    })
  }
  const role = await directusFetch<{ data: { id: string } }>(event, '/roles', {
    accessToken: adminToken,
    method: 'POST',
    body: {
      name,
      description: description === '' ? null : description,
      icon: 'supervised_user_circle',
    },
  })
  const policy = await directusFetch<{ data: { id: string } }>(
    event,
    '/policies',
    {
      accessToken: adminToken,
      method: 'POST',
      body: {
        name: `${name} policy`,
        description: description === '' ? null : description,
        app_access: true,
        admin_access: false,
      },
    },
  )
  await directusFetch(event, '/access', {
    accessToken: adminToken,
    method: 'POST',
    body: { role: role.data.id, policy: policy.data.id },
  })
  // Login and session bootstrap read /users/me with the user's own token,
  // so every custom role needs read access to its own user row — and only
  // that row. Without this, staff_role resolves to null and the account
  // fails closed to zero grants. Shape mirrors the seeded policies:
  // explicit fields + {"id": {"_eq": "$CURRENT_USER.id"}}.
  await directusFetch(event, '/permissions', {
    accessToken: adminToken,
    method: 'POST',
    body: {
      policy: policy.data.id,
      collection: 'directus_users',
      action: 'read',
      fields: [
        'id',
        'email',
        'first_name',
        'last_name',
        'staff_role',
        'status',
        'role',
        'branch',
        'branch_ids',
        'department_ids',
        'person',
        'area',
        'zone',
        'zone_ids',
      ],
      permissions: { id: { _eq: '$CURRENT_USER.id' } },
    },
  })
  return { data: { id: role.data.id, policyId: policy.data.id } }
})
