import { speakerFormSchema } from '@afc/shared'
import {
  createItem,
  findScopedItem,
  getPortalScope,
  listItems,
  throwStoreUnavailable,
  throwValidation,
} from '../../../utils/portal'
import { requireEventArea } from '../../../utils/event-access'

/**
 * POST /api/events/:id/speakers — book a speaker (AFC-843). Branch/zone
 * stamp from the parent event (0044 choice-8); person XOR name is checked
 * in the shared schema before the 0053 CHECK could fire.
 */
export default defineEventHandler(async (event) => {
  const scope = await getPortalScope(event)
  const id = getRouterParam(event, 'id')
  if (!id)
    throw createError({ statusCode: 400, statusMessage: 'An event id is required' })

  await requireEventArea(event, scope, id, 'speakers', {
    collection: 'event_speakers',
    action: 'create',
  })
  try {
    const parent = await findScopedItem<Record<string, unknown>>(
      event,
      scope,
      'events',
      id,
      {
        fields: ['id', 'branch'],
      },
    )

    const parsed = speakerFormSchema.safeParse(await readBody(event))
    if (!parsed.success) throwValidation(parsed.error)
    const form = parsed.data
    if (form.person) {
      await findScopedItem(event, scope, 'people', form.person, { fields: ['id'] })
    }

    const branch =
      typeof parent.branch === 'string' && parent.branch !== '' ? parent.branch : null
    let zone: string | null = null
    if (branch) {
      const rows = await listItems<Record<string, unknown>>(event, scope, 'branches', {
        filter: { id: { _eq: branch } },
        fields: ['zone'],
        limit: 1,
      })
      const raw = rows.data[0]?.zone
      zone = typeof raw === 'string' && raw.length > 0 ? raw : null
    }

    try {
      const created = await createItem<Record<string, unknown>>(
        event,
        scope,
        'event_speakers',
        {
          event: id,
          branch,
          zone,
          person: form.person ?? null,
          external_name: form.external_name?.trim() || null,
          status: form.status,
          special_requests: form.special_requests ?? null,
          bio: form.bio ?? null,
          created_by: scope.session.user.id,
        },
      )
      return { data: { ...created, id: String(created.id) } }
    } catch (error) {
      if ((error as { statusCode?: number })?.statusCode) throw error
      throw createError({
        statusCode: 400,
        statusMessage: 'That speaker is already booked for this event',
        data: { code: 'duplicate_booking' },
      })
    }
  } catch (error) {
    if ((error as { statusCode?: number })?.statusCode) throw error
    throwStoreUnavailable(error, 'speaker_store', '0053')
  }
})
