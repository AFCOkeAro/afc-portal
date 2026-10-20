import { departmentMemberLinkSchema } from '@afc/shared'
import {
  createItem,
  departmentScopeFilter,
  findScopedItem,
  getPortalScope,
  listItems,
  requireCan,
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
  await findScopedItem(event, scope, 'departments', id, {
    fields: ['id'],
    scope: departmentScopeFilter(scope),
  })

  const parsed = departmentMemberLinkSchema.safeParse(await readBody(event))
  if (!parsed.success) throwValidation(parsed.error)

  await findScopedItem(event, scope, 'people', parsed.data.person, { fields: ['id'] })

  const existing = await listItems<Record<string, unknown>>(
    event,
    scope,
    'people_departments',
    {
      filter: {
        _and: [{ departments: { _eq: id } }, { people: { _eq: parsed.data.person } }],
      },
      fields: ['id', 'status', 'role'],
      limit: 1,
    },
  )
  const row = existing.data[0]
  if (row && row.status === 'active') {
    return {
      data: {
        id: String(row.id),
        departments: id,
        person: parsed.data.person,
        role: String(row.role ?? 'member'),
        reactivated: false,
      },
    }
  }
  if (row) {
    const reactivated = await updateItem<Record<string, unknown>>(
      event,
      scope,
      'people_departments',
      String(row.id),
      { status: 'active', role: parsed.data.role },
    )
    return {
      data: {
        id: String(reactivated.id),
        departments: id,
        person: parsed.data.person,
        role: parsed.data.role,
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
      people: parsed.data.person,
      role: parsed.data.role,
      joined_at: new Date().toISOString().slice(0, 10),
      status: 'active',
    },
  )
  return {
    data: {
      id: String(created.id),
      departments: id,
      person: parsed.data.person,
      role: parsed.data.role,
      reactivated: false,
    },
  }
})
