import { blessingRecipientFormSchema } from '@afc/shared'
import { DirectusAuthError } from '../../utils/directus'
import {
  createItem,
  findScopedItem,
  getPortalScope,
  requireCan,
  requireZoneInScope,
  resolveBranch,
  scopeZoneIds,
  throwValidation,
} from '../../utils/portal'

/**
 * POST /api/blessing-recipients — map an individual blessing to a DB
 * person/user (AFC-671 §C).
 *
 * One person maps to one or many blessing types; the body takes a person
 * id (or attendee_user) and never a name — the person must already exist
 * in the shared DB and inside the caller's scope (a cross-scope id is a
 * 404, never a foreign link; youth index.post precedent). The row links
 * to a service or event via session/event/sunday_service (nullable, at
 * least one program link is not required — branch + service_date always
 * scope the row). Scope is unchanged (requireCan + resolveBranch +
 * requireZoneInScope); failures carry { code, fields }, never a bare 500.
 */
export default defineEventHandler(async (event) => {
  const scope = await getPortalScope(event)
  requireCan(scope, 'blessing_recipients', 'create')

  const parsed = blessingRecipientFormSchema.safeParse(await readBody(event))
  if (!parsed.success) throwValidation(parsed.error)
  const form = parsed.data

  // The person is read inside the caller's scope: a cross-scope id is a
  // 404, never a foreign link. attendee_user is a bare uuid (Directus
  // system users owned elsewhere, 0034 posture) and is not resolved.
  if (form.person) {
    await findScopedItem(event, scope, 'people', form.person, {
      fields: ['id'],
    })
  }

  const branch = resolveBranch(scope, form.branch)
  if (!branch) {
    throw createError({
      statusCode: 400,
      statusMessage: 'A branch is required: a blessing with no branch has no scope',
      data: { code: 'validation_error', fields: { branch: 'Choose a branch' } },
    })
  }

  const visibleZones = await scopeZoneIds(event, scope)
  requireZoneInScope(scope, form.zone, visibleZones)
  if (
    !scope.isArea &&
    scope.zoneIds.length === 0 &&
    form.zone &&
    !visibleZones.includes(form.zone)
  ) {
    throw createError({
      statusCode: 403,
      statusMessage: 'That zone is outside your scope',
      data: { code: 'zone_out_of_scope' },
    })
  }

  const now = new Date().toISOString()
  try {
    const created = await createItem<Record<string, unknown>>(
      event,
      scope,
      'blessing_recipients',
      {
        blessing: form.blessing ?? null,
        blessing_type: form.blessing_type,
        other_label: form.other_label?.trim() || null,
        person: form.person ?? null,
        attendee_user: form.attendee_user ?? null,
        branch,
        zone: form.zone ?? null,
        bsc: form.bsc ?? null,
        session: form.session ?? null,
        event: form.event ?? null,
        sunday_service: form.sunday_service ?? null,
        service_date: form.service_date,
        recorded_by: scope.session.user.id,
        notes: form.notes ?? null,
        created_at: now,
        updated_at: now,
      },
    )
    return { data: { ...created, id: String(created.id) } }
  } catch (cause) {
    const error = cause as { statusCode?: number; statusMessage?: string; data?: unknown }
    // The idempotent entry key (0034 UNIQUE): a second identical mapping
    // names the conflict instead of leaking a Postgres code.
    if (
      error.statusCode === 409 ||
      String(error.statusMessage ?? '').includes('unique')
    ) {
      throw createError({
        statusCode: 409,
        statusMessage:
          'That person already has this blessing recorded for the program date',
        data: {
          code: 'conflict',
          fields: { person: 'Link the existing record instead' },
        },
      })
    }
    // AFC-714 wart fix: a missing Directus role grant on blessing_recipients
    // arrives here as DirectusAuthError (server-token path) or 403
    // directus_forbidden (user-token path). Either is a permission refusal,
    // never a form error — name it 403 with { code, fields } per the
    // failure-shape rule instead of 400 with empty fields. No bare 500.
    if (
      cause instanceof DirectusAuthError ||
      error.statusCode === 403 ||
      (error.data as { code?: string } | undefined)?.code === 'directus_forbidden'
    ) {
      throw createError({
        statusCode: 403,
        statusMessage:
          'The blessings store refused this write — sign in again or ask for write access to individual blessings',
        data: {
          code: 'blessing_recipients_forbidden',
          fields: {
            blessing_recipients:
              'The blessings store refused this write — sign in again or ask for write access to individual blessings',
          },
        },
      })
    }
    throw createError({
      statusCode: 400,
      statusMessage: error.statusMessage ?? 'Could not save that individual blessing',
      data: { code: 'validation_error', fields: {} },
    })
  }
})
