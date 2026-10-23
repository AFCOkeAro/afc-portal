import { departmentGroupPatchSchema } from '@afc/shared'
import {
  createItem,
  findScopedItem,
  getPortalScope,
  listItems,
  requireCan,
  throwValidation,
  updateItem,
} from '../../utils/portal'

/**
 * PATCH /api/departments/:id — edit a group (AFC-758). Groups only: any
 * other department_type is refused with a named code (board-managed types
 * never move through the app). Editable: name, description, status, and
 * leader. A leader change demotes the previous active leaders to member
 * and links the new leader (reactivating their row when one exists).
 * Scope placement and type never move here. Failures carry { code, fields },
 * never a bare 500.
 */
export default defineEventHandler(async (event) => {
  const scope = await getPortalScope(event)
  requireCan(scope, 'departments', 'update')

  const id = getRouterParam(event, 'id')
  if (!id) {
    throw createError({ statusCode: 400, statusMessage: 'A department id is required' })
  }
  const parsed = departmentGroupPatchSchema.safeParse(await readBody(event))
  if (!parsed.success) throwValidation(parsed.error)
  const form = parsed.data

  const row = await findScopedItem<Record<string, unknown>>(
    event,
    scope,
    'departments',
    id,
    {
      fields: ['id', 'department_type'],
    },
  )
  if (row.department_type !== 'group') {
    throw createError({
      statusCode: 403,
      statusMessage: 'Only groups can be edited here — departments are board-managed',
      data: { code: 'not_a_group', fields: {} },
    })
  }

  const patch: Record<string, unknown> = {}
  if (form.name !== undefined) patch.name = form.name
  if (form.description !== undefined) patch.description = form.description
  if (form.status !== undefined) patch.status = form.status
  if (form.leader_person !== undefined) patch.leader_person = form.leader_person

  const updated =
    Object.keys(patch).length > 0
      ? await updateItem<Record<string, unknown>>(event, scope, 'departments', id, patch)
      : row

  if (form.leader_person !== undefined && form.leader_person !== null) {
    await findScopedItem(event, scope, 'people', form.leader_person, { fields: ['id'] })
    const leaders = await listItems<Record<string, unknown>>(
      event,
      scope,
      'people_departments',
      {
        filter: {
          _and: [
            { departments: { _eq: id } },
            { role: { _eq: 'leader' } },
            { status: { _eq: 'active' } },
          ],
        },
        fields: ['id', 'people'],
        limit: -1,
      },
    )
    for (const leader of leaders.data) {
      if (String(leader.people) !== form.leader_person) {
        await updateItem(event, scope, 'people_departments', String(leader.id), {
          role: 'member',
        })
      }
    }
    const existing = await listItems<Record<string, unknown>>(
      event,
      scope,
      'people_departments',
      {
        filter: {
          _and: [{ departments: { _eq: id } }, { people: { _eq: form.leader_person } }],
        },
        fields: ['id', 'status'],
        limit: 1,
      },
    )
    const current = existing.data[0]
    if (current && current.status !== 'active') {
      await updateItem(event, scope, 'people_departments', String(current.id), {
        status: 'active',
        role: 'leader',
      })
    } else if (!current) {
      await createItem(event, scope, 'people_departments', {
        departments: id,
        people: form.leader_person,
        role: 'leader',
        joined_at: new Date().toISOString().slice(0, 10),
        status: 'active',
      })
    }
  }

  return {
    data: { ...updated, id: String((updated as Record<string, unknown>).id ?? id) },
  }
})
