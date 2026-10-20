import type { H3Event } from 'h3'
import { findScopedItem, listItems, type PortalScope } from './portal'

/**
 * Department-head guard for the roster (AFC-473, expansion §10 + §11 row
 * `service_assignments`: dept head `CRU (assigned dept roles)`).
 *
 * A department head may only roster people who hold a membership in one of
 * the head's own departments. `people_departments` is the membership store
 * (data-model §2.4); an empty intersection is a 403, never a silent skip.
 * Other roles are unaffected: their branch/zone scope already applied at
 * the service level.
 */
export async function requireDeptScopeForPerson(
  event: H3Event,
  scope: PortalScope,
  personId: string,
): Promise<void> {
  if (scope.role !== 'department_leader') return
  const departments = scope.session.user.departmentIds ?? []
  if (departments.length === 0) {
    throw createError({
      statusCode: 403,
      statusMessage: 'That person is outside your departments',
      data: { code: 'department_out_of_scope' },
    })
  }
  await findScopedItem(event, scope, 'people', personId, { fields: ['id'] })
  const membership = await listItems<Record<string, unknown>>(
    event,
    scope,
    'people_departments',
    {
      filter: {
        _and: [
          { people: { _eq: personId } },
          { departments: { _in: departments } },
          { status: { _eq: 'active' } },
        ],
      },
      fields: ['id'],
      limit: 1,
    },
  )
  if (membership.data.length === 0) {
    throw createError({
      statusCode: 403,
      statusMessage: 'That person is outside your departments',
      data: { code: 'department_out_of_scope' },
    })
  }
}
