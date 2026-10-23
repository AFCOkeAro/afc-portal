import { departmentGroupCreateSchema } from '@afc/shared'
import { isUniqueViolation } from '../../utils/event-invites'
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
 * POST /api/departments — create a group (AFC-758). Staff may create groups
 * only: any other department_type is refused with a named code (the schema
 * only accepts the group literal), and groups are area-scoped (branch must
 * be null with an area set — the Groups 1-4 precedent). A leader, when
 * given, is linked as a junction leader row in the same request (reactive
 * semantics mirror the member link route: re-link reactivates).
 * Failures carry { code, fields }, never a bare 500.
 */
export default defineEventHandler(async (event) => {
  const scope = await getPortalScope(event)
  requireCan(scope, 'departments', 'create')

  const parsed = departmentGroupCreateSchema.safeParse(await readBody(event))
  if (!parsed.success) throwValidation(parsed.error)
  const form = parsed.data

  const area = await findScopedItem<Record<string, unknown>>(
    event,
    scope,
    'areas',
    form.area,
    {
      fields: ['id'],
    },
  ).catch(() => null)
  if (!area) {
    throw createError({
      statusCode: 403,
      statusMessage: 'That area is outside your scope',
      data: { code: 'area_out_of_scope', fields: { area: 'Choose an area you can see' } },
    })
  }

  let created: Record<string, unknown>
  try {
    created = await createItem<Record<string, unknown>>(event, scope, 'departments', {
      name: form.name,
      code: form.code,
      department_type: 'group',
      branch: null,
      zone: null,
      area: form.area,
      leader_person: form.leader_person ?? null,
      description: form.description ?? null,
      status: 'active',
    })
  } catch (cause) {
    const error = cause as {
      statusCode?: number
      statusMessage?: string
    }
    // AFC-766: staging Directus answers a duplicate code with a 400 unique
    // failure ('Value ... has to be unique', extensions code
    // RECORD_NOT_UNIQUE) rather than 409, so the original matcher
    // (statusCode 409 or 'departments_code_key') never fired and the raw
    // passthrough leaked. Reuse the canonical isUniqueViolation() detector
    // so there is one abstraction for unique detection — anything else
    // rethrows (fail closed).
    if (
      error.statusCode === 409 ||
      String(error.statusMessage ?? '').includes('departments_code_key') ||
      isUniqueViolation(cause)
    ) {
      throw createError({
        statusCode: 409,
        statusMessage: 'That group code is already in use',
        data: { code: 'conflict', fields: { code: 'Pick a unique group code' } },
      })
    }
    throw cause
  }

  const departmentId = String(created.id)
  if (form.leader_person) {
    await findScopedItem(event, scope, 'people', form.leader_person, { fields: ['id'] })
    const existing = await listItems<Record<string, unknown>>(
      event,
      scope,
      'people_departments',
      {
        filter: {
          _and: [
            { departments: { _eq: departmentId } },
            { people: { _eq: form.leader_person } },
          ],
        },
        fields: ['id', 'status'],
        limit: 1,
      },
    )
    const row = existing.data[0]
    if (row && row.status !== 'active') {
      await updateItem(event, scope, 'people_departments', String(row.id), {
        status: 'active',
        role: 'leader',
      })
    } else if (!row) {
      await createItem(event, scope, 'people_departments', {
        departments: departmentId,
        people: form.leader_person,
        role: 'leader',
        joined_at: new Date().toISOString().slice(0, 10),
        status: 'active',
      })
    }
  }

  return { data: { ...created, id: departmentId } }
})
