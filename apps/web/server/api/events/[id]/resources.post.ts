import { resourceFormSchema } from '@afc/shared'
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
 * POST /api/events/:id/resources — share a resource (AFC-844). New items
 * always open pending; approval is a separate PATCH. Speaker and
 * branch/zone stamp from the parent event and the linked speaker row.
 */
export default defineEventHandler(async (event) => {
  const scope = await getPortalScope(event)
  const id = getRouterParam(event, 'id')
  if (!id)
    throw createError({ statusCode: 400, statusMessage: 'An event id is required' })

  await requireEventArea(event, scope, id, 'resources', {
    collection: 'event_resources',
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

    const parsed = resourceFormSchema.safeParse(await readBody(event))
    if (!parsed.success) throwValidation(parsed.error)
    const form = parsed.data

    if (form.speaker) {
      await findScopedItem(event, scope, 'event_speakers', form.speaker, {
        fields: ['id', 'event'],
      })
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

    const created = await createItem<Record<string, unknown>>(
      event,
      scope,
      'event_resources',
      {
        event: id,
        speaker: form.speaker ?? null,
        branch,
        zone,
        title: form.title,
        source_type: form.source_type,
        kind: form.kind,
        url: form.source_type === 'link' ? (form.url?.trim() ?? null) : null,
        file_id: form.source_type === 'upload' ? (form.file_id ?? null) : null,
        status: 'pending',
        created_by: scope.session.user.id,
      },
    )
    return { data: { ...created, id: String(created.id) } }
  } catch (error) {
    if ((error as { statusCode?: number })?.statusCode) throw error
    throwStoreUnavailable(error, 'resource_store', '0054')
  }
})
