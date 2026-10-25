import { departmentGuideCreateSchema } from '@afc/shared'
import {
  can,
  createItem,
  departmentScopeFilter,
  findScopedItem,
  getPortalScope,
  listItems,
  throwStoreUnavailable,
  throwValidation,
} from '../../../utils/portal'

/**
 * POST /api/departments/:id/guides — add a guide to a department (AFC-800,
 * parent AFC-759).
 *
 * Writer gate: can(scope, 'departments', 'update') OR the caller holds an
 * active leader link (people_departments role=leader status=active for this
 * department + scope user). Anything else is a 403 with code `forbidden`.
 * The parent loads scoped first (out-of-scope parent -> scoped 404, never
 * foreign rows). Failures carry { code, fields }, never a bare 500.
 */
export default defineEventHandler(async (event) => {
  const scope = await getPortalScope(event)

  const id = getRouterParam(event, 'id')
  if (!id) {
    throw createError({ statusCode: 400, statusMessage: 'A department id is required' })
  }

  const parsed = departmentGuideCreateSchema.safeParse(await readBody(event))
  if (!parsed.success) throwValidation(parsed.error)
  const form = parsed.data

  // AFC-800: scoped parent read + writer check hit the 0020/0043 stores.
  // Unreadable store -> named error, never a bare 500; deliberate 4xx
  // (scope 404s, validation, the 403 below) pass through untouched.
  try {
    await findScopedItem(event, scope, 'departments', id, {
      fields: ['id'],
      scope: departmentScopeFilter(scope),
    })

    if (!can(scope, 'departments', 'update')) {
      const personId = scope.session.user.personId
      const leader = personId
        ? await listItems<Record<string, unknown>>(event, scope, 'people_departments', {
            filter: {
              _and: [
                { departments: { _eq: id } },
                { people: { _eq: personId } },
                { role: { _eq: 'leader' } },
                { status: { _eq: 'active' } },
              ],
            },
            fields: ['id'],
            limit: 1,
          })
        : null
      if (!leader || leader.data.length === 0) {
        throw createError({
          statusCode: 403,
          statusMessage: 'Only department editors and leaders can write guides',
          data: { code: 'forbidden', fields: {} },
        })
      }
    }
  } catch (error) {
    if ((error as { statusCode?: number })?.statusCode) throw error
    throwStoreUnavailable(error, 'department_store', '0043')
  }

  try {
    const created = await createItem<Record<string, unknown>>(
      event,
      scope,
      'department_guides',
      {
        department: id,
        title: form.title,
        body: form.body,
        sort_order: form.sort_order,
      },
    )
    return { data: { ...created, id: String(created.id ?? '') } }
  } catch (error) {
    if ((error as { statusCode?: number })?.statusCode) throw error
    throwStoreUnavailable(error, 'department_store', '0043')
  }
})
