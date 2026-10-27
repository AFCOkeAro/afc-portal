import { departmentGuidePatchSchema } from '@afc/shared'
import {
  can,
  departmentScopeFilter,
  findScopedItem,
  getPortalScope,
  listItems,
  throwStoreUnavailable,
  throwValidation,
  updateItem,
} from '../../../../utils/portal'

/**
 * PATCH /api/departments/:id/guides/:guideId — edit a department guide
 * (AFC-800, parent AFC-759).
 *
 * Same writer gate as POST: can(scope, 'departments', 'update') OR an
 * active leader link on this department, else 403 code `forbidden`. Guides
 * are scoped to the parent: a guideId that belongs to another department is
 * a 404, never a cross-department edit. Editable: title/body/sort_order
 * only — placement (department) never moves. There is NO DELETE route
 * (retention posture; asserted by
 * tests/web/department-guides.contract.mjs). Failures carry
 * { code, fields }, never a bare 500.
 */
export default defineEventHandler(async (event) => {
  const scope = await getPortalScope(event)

  const id = getRouterParam(event, 'id')
  if (!id) {
    throw createError({ statusCode: 400, statusMessage: 'A department id is required' })
  }
  const guideId = getRouterParam(event, 'guideId')
  if (!guideId) {
    throw createError({ statusCode: 400, statusMessage: 'A guide id is required' })
  }

  const parsed = departmentGuidePatchSchema.safeParse(await readBody(event))
  if (!parsed.success) throwValidation(parsed.error)
  const form = parsed.data

  // AFC-800: scoped reads + writer check hit the 0020/0043 stores.
  // Unreadable store -> named error, never a bare 500; deliberate 4xx
  // (scope 404s, validation, the 403 below) pass through untouched.
  let guide: Record<string, unknown>
  try {
    await findScopedItem(event, scope, 'departments', id, {
      fields: ['id'],
      scope: departmentScopeFilter(scope),
    })

    guide = await findScopedItem<Record<string, unknown>>(
      event,
      scope,
      'department_guides',
      guideId,
      {
        fields: [
          'id',
          'department',
          'title',
          'body',
          'sort_order',
          'created_at',
          'updated_at',
        ],
        scope: { department: { _eq: id } },
      },
    )

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

  const patch: Record<string, unknown> = {}
  if (form.title !== undefined) patch.title = form.title
  if (form.body !== undefined) patch.body = form.body
  if (form.sort_order !== undefined) patch.sort_order = form.sort_order
  if (Object.keys(patch).length > 0) patch.updated_at = new Date().toISOString()

  try {
    const updated =
      Object.keys(patch).length > 0
        ? await updateItem<Record<string, unknown>>(
            event,
            scope,
            'department_guides',
            guideId,
            patch,
          )
        : guide
    return {
      data: {
        ...updated,
        id: String((updated as Record<string, unknown>).id ?? guideId),
      },
    }
  } catch (error) {
    if ((error as { statusCode?: number })?.statusCode) throw error
    throwStoreUnavailable(error, 'department_store', '0043')
  }
})
