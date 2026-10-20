import { registrationFormSchema } from '@afc/shared'
import {
  groupMemberKey,
  splitGroupReplay,
  toStaffPayload,
} from '../../../utils/event-registration-completion'
import {
  createItem,
  eventScopeFilter,
  findScopedItem,
  getPortalScope,
  listItems,
  requireCan,
  resolveBranch,
} from '../../../utils/portal'

/** Smallest defensible batch cap: keeps one request inside Directus limits. */
const MAX_GROUP_MEMBERS = 50

/**
 * Staff group registration (AFC-470 §4): N members, one `group_code`.
 *
 * Staff-only (create grant). Every member is validated up front against
 * `registrationFormSchema`, so one bad row rejects the whole batch before
 * anything is written. Idempotency keys on (event, group_code, normalized
 * phone/email+name) are checked against the event's existing rows: a retry
 * with the same keys creates zero new rows and answers with the original
 * rows instead.
 *
 * `group_code` persistence: `event_registrations.group_code` (nullable
 * text, <=64 chars, data-model.md §3.2, migration 20261020_0017) stores
 * the validated code on every created row. The S4 group-record page
 * queries by (event, group_code) and the idempotency key has stored
 * ground truth instead of a request-echoed value.
 *
 * Sequential creates are not a DB transaction (Directus REST has none), so
 * a mid-batch failure returns the ids already written; retrying the same
 * payload then skips those rows via the idempotency check instead of
 * duplicating them.
 */
export default defineEventHandler(async (event) => {
  const scope = await getPortalScope(event)
  requireCan(scope, 'event_registrations', 'create')

  const id = getRouterParam(event, 'id')
  if (!id)
    throw createError({ statusCode: 400, statusMessage: 'An event id is required' })
  const eventRow = await findScopedItem<Record<string, unknown>>(
    event,
    scope,
    'events',
    id,
    { fields: ['id', 'branch'], scope: eventScopeFilter(scope) },
  )

  const body = ((await readBody(event)) ?? {}) as Record<string, unknown>
  const groupCode = String(body.group_code ?? '').trim()
  const members = body.members
  const fields: Record<string, string> = {}
  if (!groupCode) fields.group_code = 'Give this group submission a code'
  else if (groupCode.length > 64)
    fields.group_code = 'Keep the group code to 64 characters'
  if (!Array.isArray(members) || members.length === 0) {
    fields.members = 'Add at least one member to the group'
  } else if (members.length > MAX_GROUP_MEMBERS) {
    fields.members = `A group holds at most ${MAX_GROUP_MEMBERS} members per submission`
  }
  if (Object.keys(fields).length > 0) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Some group fields need attention',
      data: { code: 'validation_error', fields },
    })
  }

  const validMembers: Array<Record<string, unknown>> = []
  const memberErrors: Record<string, string> = {}
  ;(members as Array<Record<string, unknown>>).forEach((member, index) => {
    const parsed = registrationFormSchema.safeParse({ ...(member as object), event: id })
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        const key = `members.${index}.${issue.path.map(String).join('.')}`
        if (!memberErrors[key]) memberErrors[key] = issue.message
      }
      return
    }
    const branch = resolveBranch(scope, parsed.data.branch, { allowAreaWide: true })
    validMembers.push({
      ...toStaffPayload(parsed.data),
      event: id,
      branch: branch ?? eventRow.branch ?? null,
      group_code: groupCode,
    })
  })
  if (Object.keys(memberErrors).length > 0) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Some group members need attention — nothing was registered',
      data: { code: 'validation_error', fields: memberErrors },
    })
  }

  const existing = await listItems<Record<string, unknown>>(
    event,
    scope,
    'event_registrations',
    {
      filter: { event: { _eq: id } },
      fields: ['registrant_first_name', 'registrant_last_name', 'email', 'phone'],
      limit: -1,
    },
  )
  const existingKeys = new Set(
    existing.data.map((row) => groupMemberKey(id, groupCode, row)),
  )
  const { toCreate, skipped } = splitGroupReplay(
    existingKeys,
    id,
    groupCode,
    validMembers,
  )

  const created: Array<Record<string, unknown>> = []
  const createdIds: string[] = []
  try {
    for (const payload of toCreate) {
      const row = await createItem<Record<string, unknown>>(
        event,
        scope,
        'event_registrations',
        payload,
      )
      created.push({ ...row, id: String(row.id) })
      createdIds.push(String(row.id))
    }
  } catch (cause) {
    throw createError({
      statusCode: 502,
      statusMessage: `Saved ${created.length} of ${toCreate.length} new members before failing — retry the same payload; written rows are skipped, never duplicated`,
      data: {
        code: 'group_partial_failure',
        group_code: groupCode,
        created_ids: createdIds,
        cause: (cause as { message?: string }).message ?? 'unknown',
      },
    })
  }

  return {
    data: created,
    meta: {
      group_code: groupCode,
      created: created.length,
      skipped: skipped.length,
      total: validMembers.length,
    },
  }
})
