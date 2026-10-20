import { departmentMemberUnlinkSchema } from '@afc/shared'
import {
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
 * DELETE /api/departments/:id/members — unlink a person from the department.
 *
 * Sets the junction row to `inactive` rather than deleting it, so the
 * assignment history survives and a later re-link reactivates the same row.
 * Requires the junction's update grant (not delete): department leaders hold
 * CRU but not delete on `people_departments` (§10), and removing a member is
 * an update to the membership either way. Body (or `?person=`) names the
 * person.
 */
export default defineEventHandler(async (event) => {
  const scope = await getPortalScope(event)
  requireCan(scope, 'people_departments', 'update')

  const id = getRouterParam(event, 'id')
  if (!id) {
    throw createError({ statusCode: 400, statusMessage: 'A department id is required' })
  }
  // AFC-566: scope-gate, junction read and deactivation all hit 0020
  // collections. Unreadable store → named error, never a bare 500; the
  // deliberate not-a-member 404 passes through untouched.
  try {
    await findScopedItem(event, scope, 'departments', id, {
      fields: ['id'],
      scope: departmentScopeFilter(scope),
    })

    const query = getQuery(event)
    const parsed = departmentMemberUnlinkSchema.safeParse(
      (await readBody(event).catch(() => null)) ??
        (typeof query.person === 'string' ? { person: query.person } : null),
    )
    if (!parsed.success) throwValidation(parsed.error)

    const existing = await listItems<Record<string, unknown>>(
      event,
      scope,
      'people_departments',
      {
        filter: {
          _and: [
            { departments: { _eq: id } },
            { people: { _eq: parsed.data.person } },
            { status: { _eq: 'active' } },
          ],
        },
        fields: ['id'],
        limit: 1,
      },
    )
    const row = existing.data[0]
    if (!row) {
      throw createError({
        statusCode: 404,
        statusMessage: 'That person is not an active member of this department',
        data: { code: 'not_found' },
      })
    }

    await updateItem(event, scope, 'people_departments', String(row.id), {
      status: 'inactive',
    })
    return { data: { id: parsed.data.person, departments: id, status: 'inactive' } }
  } catch (error) {
    if ((error as { statusCode?: number })?.statusCode) throw error
    throwStoreUnavailable(error, 'department_store', '0020')
  }
})
