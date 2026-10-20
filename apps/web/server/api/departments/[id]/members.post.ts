import { departmentMemberLinkSchema } from '@afc/shared'
import {
  createItem,
  departmentScopeFilter,
  findScopedItem,
  getPortalScope,
  listItems,
  requireCan,
  throwStoreUnavailable,
  throwValidation,
  updateItem,
} from '../../../utils/portal'

/**
 * POST /api/departments/:id/members — link a person into the department.
 *
 * Writes the `people_departments` junction (data-model §2.4), so the
 * junction's create grant governs. Unlink deactivates instead of deleting, so
 * re-linking reactivates the same row rather than colliding with the unique
 * (people, departments) pair.
 */
export default defineEventHandler(async (event) => {
  const scope = await getPortalScope(event)
  requireCan(scope, 'people_departments', 'create')

  const id = getRouterParam(event, 'id')
  if (!id) {
    throw createError({ statusCode: 400, statusMessage: 'A department id is required' })
  }
  // AFC-566: scope-gate and junction reads/writes below hit 0020
  // collections. Map an unreadable store to the named error, never a bare
  // 500; deliberate 4xx (scope 404s, validation) pass through untouched.
  let existing: { data: Record<string, unknown>[] }
  let personId: string
  let role: string
  try {
    await findScopedItem(event, scope, 'departments', id, {
      fields: ['id'],
      scope: departmentScopeFilter(scope),
    })

    const parsed = departmentMemberLinkSchema.safeParse(await readBody(event))
    if (!parsed.success) throwValidation(parsed.error)
    personId = parsed.data.person
    role = parsed.data.role

    await findScopedItem(event, scope, 'people', personId, { fields: ['id'] })

    existing = await listItems<Record<string, unknown>>(
      event,
      scope,
      'people_departments',
      {
        filter: {
          _and: [{ departments: { _eq: id } }, { people: { _eq: personId } }],
        },
        fields: ['id', 'status', 'role'],
        limit: 1,
      },
    )
  } catch (error) {
    if ((error as { statusCode?: number })?.statusCode) throw error
    throwStoreUnavailable(error, 'department_store', '0020')
  }
  const row = existing.data[0]
  if (row && row.status === 'active') {
    return {
      data: {
        id: String(row.id),
        departments: id,
        person: personId,
        role: String(row.role ?? 'member'),
        reactivated: false,
      },
    }
  }
  // Junction writes hit the same 0020 store: same named error, same 4xx
  // passthrough (validation already returned above; update/create 404s
  // from Directus stay 404s).
  try {
    if (row) {
      const reactivated = await updateItem<Record<string, unknown>>(
        event,
        scope,
        'people_departments',
        String(row.id),
        { status: 'active', role },
      )
      return {
        data: {
          id: String(reactivated.id),
          departments: id,
          person: personId,
          role,
          reactivated: true,
        },
      }
    }

    const created = await createItem<Record<string, unknown>>(
      event,
      scope,
      'people_departments',
      {
        departments: id,
        people: personId,
        role,
        joined_at: new Date().toISOString().slice(0, 10),
        status: 'active',
      },
    )
    return {
      data: {
        id: String(created.id),
        departments: id,
        person: personId,
        role,
        reactivated: false,
      },
    }
  } catch (error) {
    if ((error as { statusCode?: number })?.statusCode) throw error
    throwStoreUnavailable(error, 'department_store', '0020')
  }
})
