import { grantsForRole } from '@afc/shared/role-matrix'
import { requireArea } from '../../../../utils/admin-guard'
import {
  overridesForRole,
  policiesForRole,
  staffRoleForDirectusRoleName,
} from '../../../../utils/custom-grants'
import { directusFetch } from '../../../../utils/directus'
import { directusAdminToken } from '../../../../utils/directus-admin'

/**
 * GET /api/admin/roles/:id/permissions — the effective grant set behind one
 * role (AFC-669, extended AFC-836).
 *
 * Merges three layers so the matrix UI can show checks and dashes for every
 * role, built-in or custom: the code matrix (built-ins), stored Directus
 * rows (customs, plus anything an admin added), and super-admin overrides
 * (revoke wins). Each row names its sources so the UI picks the right
 * write path (add vs revoke vs un-revoke).
 */
export default defineEventHandler(async (event) => {
  await requireArea(event)
  const adminToken = await directusAdminToken(event)
  const id = String(getRouterParam(event, 'id') ?? '')

  const role = await directusFetch<{ data: { name: string } | null }>(
    event,
    `/roles/${id}`,
    {
      accessToken: adminToken,
      query: { fields: 'name' },
    },
  ).catch(() => null)
  const directusName = typeof role?.data?.name === 'string' ? role.data.name : ''
  const staffRole = staffRoleForDirectusRoleName(directusName) ?? directusName

  const matrix = grantsForRole(staffRole as never).map((grant) => ({
    collection: String(grant.collection),
    action: String(grant.action),
  }))

  const policies = await policiesForRole(event, adminToken, id)
  const stored: Array<{
    id: string
    collection: string
    action: string
    filter: unknown
  }> = []
  if (policies.length > 0) {
    const permissions = await directusFetch<{
      data: Array<{
        id: string
        collection: string
        action: string
        permissions: Record<string, unknown> | null
      }>
    }>(event, '/permissions', {
      accessToken: adminToken,
      query: {
        filter: { policy: { _in: policies } },
        fields: 'id,collection,action,permissions',
        limit: -1,
      },
    }).catch(() => null)
    for (const row of permissions?.data ?? []) {
      stored.push({
        id: row.id,
        // Canonical collection key (directus_users, not the UI nickname):
        // the matrix UI, the override table and requireCan all key on this.
        collection: row.collection,
        action: row.action,
        filter: row.permissions,
      })
    }
  }

  const overrides = await overridesForRole(event, staffRole).catch(() => [])
  const revoked = new Set(
    overrides
      .filter((o) => o.effect === 'revoke')
      .map((o) => `${o.collection}:${o.action}`),
  )
  const grantedByOverride = new Set(
    overrides
      .filter((o) => o.effect === 'grant')
      .map((o) => `${o.collection}:${o.action}`),
  )

  const byKey = new Map<
    string,
    {
      collection: string
      action: string
      sources: string[]
      ref: string | null
      filter: unknown
    }
  >()
  const put = (
    collection: string,
    action: string,
    source: string,
    ref: string | null,
    filter: unknown,
  ) => {
    const key = `${collection}:${action}`
    const found = byKey.get(key)
    if (!found) {
      byKey.set(key, { collection, action, sources: [source], ref, filter })
    } else {
      if (!found.sources.includes(source)) found.sources.push(source)
      if (found.ref === null) {
        found.ref = ref
        found.filter = filter
      }
    }
  }
  for (const grant of matrix) put(grant.collection, grant.action, 'matrix', null, null)
  for (const row of stored) put(row.collection, row.action, 'stored', row.id, row.filter)
  for (const key of grantedByOverride) {
    const [collection, action] = key.split(':')
    put(collection ?? '', action ?? '', 'override', null, null)
  }

  const data = [...byKey.values()]
    .filter((row) => !revoked.has(`${row.collection}:${row.action}`))
    .map((row) => ({ ...row, granted: true }))
  const revokedRows = [...revoked].map((key) => {
    const [collection, action] = key.split(':')
    return {
      collection: collection ?? '',
      action: action ?? '',
      sources: ['revoked'],
      ref: null as string | null,
      filter: null as unknown,
      granted: false,
    }
  })
  return { data: [...data, ...revokedRows] }
})
