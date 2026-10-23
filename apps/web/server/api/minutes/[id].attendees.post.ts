import { attendeeFormSchema } from '@afc/shared'
import {
  assertUuidParam,
  can,
  createItem,
  findScopedItem,
  getPortalScope,
  isUuid,
  requireCan,
  scopeFilter,
  throwValidation,
} from '../../utils/portal'
import { directusFetch } from '../../utils/directus'
import { writeOfficeAudit } from '../../utils/office'

/**
 * POST /api/minutes/:id/attendees — attach a person/user attendee (US-E3 AC2).
 *
 * Gate (AFC-701 verdict B, AFC-702 F1–F4): `office_minutes:update` keeps the
 * existing path. Otherwise a create-only author may attach to their own draft:
 * `office_minutes:create` + same-branch scoped row + `created_by === session
 * user` + `status === 'draft'`. Anything else throws the existing 403 shape.
 * No `minutes_attendees` grant path is consulted (role-matrix untouched).
 *
 * F1 residual: the portal gate is the only control in policy-less staging
 * (portal.ts). Do not enable this exception where a Directus row policy is
 * installed unless that policy mirrors the same three conditions
 * (branch scope + created_by + draft). The mirror exists: migration 0033
 * denormalises the two parent facts onto minutes_attendees
 * (minute_status/minute_created_by, trigger-maintained) so the flat
 * Directus filter in apps/web/server/utils/minutes-policy.ts
 * (MINUTES_ATTENDEE_CREATE_FILTER) can express them without relation
 * metadata, and the admin grant endpoint defaults that filter for
 * minutes_attendees:create. Owner: CTO.
 *
 * F3 deviation recorded: AFC-702 suggested `event_type: 'attendee_added'`, but
 * migration 0013 CHECK-constrains `office_minute_events.event_type` to
 * ('created','updated','status_changed','note'), so the audit row uses
 * `'note'` with an explicit detail string. The write is best-effort
 * (swallow-and-log inside `writeOfficeAudit`) and never masks the attach.
 */
export default defineEventHandler(async (event) => {
  const scope = await getPortalScope(event)
  // F4: validate the shape at the boundary before any store read (AFC-654).
  const id = assertUuidParam(getRouterParam(event, 'id'), 'minutes', 'invalid_minutes_id')

  if (can(scope, 'office_minutes', 'update')) {
    requireCan(scope, 'office_minutes', 'update')
    await findScopedItem(event, scope, 'office_minutes', id, {
      scope: scopeFilter(scope),
    })
  } else {
    if (!can(scope, 'office_minutes', 'create')) {
      // Same 403 shape as requireCan (throws; never returns).
      requireCan(scope, 'office_minutes', 'update')
    }
    // F4: explicit fields; NULL/undefined created_by or status denies below.
    const row = await findScopedItem<Record<string, unknown>>(
      event,
      scope,
      'office_minutes',
      id,
      { fields: ['id', 'created_by', 'status', 'branch'], scope: scopeFilter(scope) },
    )
    const createdBy = row.created_by
    const isAuthor =
      typeof createdBy === 'string' &&
      createdBy.length > 0 &&
      createdBy === scope.session.user.id
    if (!isAuthor || row.status !== 'draft') {
      requireCan(scope, 'office_minutes', 'update')
    }
  }

  const parsed = attendeeFormSchema.safeParse(await readBody(event))
  if (!parsed.success) throwValidation(parsed.error)

  // F2: a supplied person must resolve inside the caller's branch scope, and
  // an attendee_user must exist. Malformed uuids are 400 (never reach the DB
  // as `_eq` against a uuid column); out-of-scope persons are the scoped
  // 404 from findScopedItem.
  if (parsed.data.person) {
    if (!isUuid(parsed.data.person)) {
      throw createError({
        statusCode: 400,
        statusMessage: 'Some fields need attention',
        data: { code: 'validation_error', fields: { person: 'Choose the person' } },
      })
    }
    await findScopedItem(event, scope, 'people', parsed.data.person, { fields: ['id'] })
  }
  if (parsed.data.attendee_user) {
    if (!isUuid(parsed.data.attendee_user)) {
      throw createError({
        statusCode: 400,
        statusMessage: 'Some fields need attention',
        data: {
          code: 'validation_error',
          fields: { attendee_user: 'Choose the user' },
        },
      })
    }
    try {
      const found = await directusFetch<{ data: { id: string } | null }>(
        event,
        `/users/${parsed.data.attendee_user}`,
        { accessToken: scope.token, query: { fields: 'id' } },
      )
      if (!found?.data) {
        throw createError({
          statusCode: 404,
          statusMessage: 'That record was not found in your scope',
          data: { code: 'not_found' },
        })
      }
    } catch (error) {
      if ((error as { statusCode?: number })?.statusCode === 404) throw error
      const status = (error as { statusCode?: number })?.statusCode
      if (typeof status === 'number' && status >= 400 && status < 500) throw error
      throw createError({
        statusCode: 503,
        statusMessage:
          'The user registry is unavailable, so the attendee cannot be verified',
        data: { code: 'attendee_user_unverifiable' },
      })
    }
  }

  const created = await createItem<Record<string, unknown>>(
    event,
    scope,
    'minutes_attendees',
    {
      minute: id,
      person: parsed.data.person ?? null,
      attendee_user: parsed.data.attendee_user ?? null,
    },
  )

  // F3: audit every successful attach (both paths); best-effort, never masks.
  await writeOfficeAudit(event, scope, 'office_minute_events', {
    minute: id,
    event_type: 'note',
    detail: 'Attendee attached to minutes',
    actor_user: scope.session.user.id,
    created_at: new Date().toISOString(),
  })

  return { data: { ...created, id: String(created.id) } }
})
