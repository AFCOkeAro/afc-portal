import { toPersonPayload, visitorConvertSchema } from '@afc/shared'
import {
  createItem,
  findScopedItem,
  getPortalScope,
  requireCan,
  throwValidation,
  updateItem,
} from '../../utils/portal'
import { JOURNEY_FIELDS, findDuplicateCandidates } from '../../utils/visitor-journey'

/**
 * Convert a newcomer: create (or link) the `people` row, set
 * `visitors.person`, mark `converted`, keep the visitor trail.
 *
 * Idempotent: a visitor that already links a person returns that link with
 * `already_converted: true` and creates nothing. Duplicates never merge
 * silently: phone/email matches across people + visitors (any branch) come
 * back as `duplicates`, and the branch admin decides merge (mode 'link'
 * with person_id) or keep-separate (mode 'create' anyway).
 */
export default defineEventHandler(async (event) => {
  const scope = await getPortalScope(event)
  requireCan(scope, 'visitors', 'update')
  requireCan(scope, 'people', 'create')

  const body = (await readBody(event)) as Record<string, unknown>
  const id = typeof body.id === 'string' ? body.id : null
  if (!id) {
    throw createError({
      statusCode: 400,
      statusMessage: 'A visitor id is required',
      data: { code: 'validation_error' },
    })
  }
  const parsed = visitorConvertSchema.safeParse({
    person_id: body.person_id,
    mode: body.mode,
    first_name: body.first_name,
    last_name: body.last_name,
  })
  if (!parsed.success) throwValidation(parsed.error)

  const visitor = await findScopedItem<Record<string, unknown>>(
    event,
    scope,
    'visitors',
    id,
    { fields: JOURNEY_FIELDS },
  )

  // Idempotency: the link is the state. A replay returns the same link.
  if (visitor.person) {
    return {
      data: {
        visitor_id: id,
        person_id: String(visitor.person),
        already_converted: true,
        duplicates: [],
      },
    }
  }

  const phone = (visitor.phone as string | null) ?? null
  const email = (visitor.email as string | null) ?? null
  const duplicates = await findDuplicateCandidates(event, scope, {
    phone,
    email,
    excludeVisitorId: id,
  })

  let personId: string
  if (parsed.data.mode === 'link') {
    if (!parsed.data.person_id) {
      throw createError({
        statusCode: 400,
        statusMessage: 'Choose the existing person to link to',
        data: { code: 'validation_error' },
      })
    }
    // The linked person must be readable in scope -- no blind link.
    await findScopedItem(event, scope, 'people', parsed.data.person_id, {
      fields: ['id'],
    })
    personId = parsed.data.person_id
  } else {
    const firstName =
      parsed.data.first_name ?? (visitor.visitor_first_name as string | null) ?? ''
    const lastName =
      parsed.data.last_name ?? (visitor.visitor_last_name as string | null) ?? ''
    if (!firstName.trim() || !lastName.trim()) {
      throw createError({
        statusCode: 400,
        statusMessage: 'A first and last name are required to create the person',
        data: { code: 'validation_error' },
      })
    }
    const created = await createItem<{ id: string | number }>(event, scope, 'people', {
      ...toPersonPayload({
        first_name: firstName.trim(),
        last_name: lastName.trim(),
        preferred_name: undefined,
        other_names: undefined,
        gender: 'unspecified',
        date_of_birth: undefined,
        phone: phone ?? undefined,
        email: email ?? undefined,
        address: undefined,
        branch: (visitor.branch as string | null) ?? undefined,
        membership_status: 'member',
        member_since: new Date().toISOString().slice(0, 10),
        guardian: undefined,
        consent_data: false,
        consent_media: false,
        // AFC-476 added §4.2 fields to PersonForm; a converted visitor is
        // not known to be an entrepreneur (toPersonPayload defaults false).
        is_entrepreneur: false,
      }),
      is_minor: false,
      status: 'active',
    })
    personId = String(created.id)
  }

  // The trail is preserved both ways: visitors.person points at the person,
  // and the visitor row (journey stages, follow-ups, transitions) is never
  // rewritten by conversion -- the reverse lookup is visitors?person=<id>.
  await updateItem(event, scope, 'visitors', id, {
    person: personId,
    status: 'converted',
    last_contact_at: new Date().toISOString(),
  })

  return {
    data: {
      visitor_id: id,
      person_id: personId,
      already_converted: false,
      duplicates,
    },
  }
})
