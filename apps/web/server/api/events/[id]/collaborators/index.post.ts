import { collaboratorFormSchema } from '@afc/shared'
import {
  createItem,
  findScopedItem,
  getPortalScope,
  requireCan,
  throwStoreUnavailable,
  throwValidation,
} from '../../../../utils/portal'

/**
 * POST /api/events/:id/collaborators — add a collaborator (AFC-880).
 * Gated on events update: only someone who can edit the whole programme
 * may delegate parts of it. The person must be a real person row (no
 * dangling delegations); branch/zone are stamped from the parent event
 * (0044 choice-8: denorms, SET NULL, no scope trigger).
 */
export default defineEventHandler(async (event) => {
  const scope = await getPortalScope(event)
  requireCan(scope, 'events', 'update')

  const id = getRouterParam(event, 'id')
  if (!id)
    throw createError({ statusCode: 400, statusMessage: 'An event id is required' })
  const parsed = collaboratorFormSchema.safeParse(await readBody(event))
  if (!parsed.success) throwValidation(parsed.error)
  const form = parsed.data
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
    const person = await findScopedItem(event, scope, 'people', form.person, {
      fields: ['id'],
    }).catch(() => null)
    if (!person) {
      throw createError({
        statusCode: 404,
        statusMessage: 'That person was not found in your scope',
        data: { code: 'person_not_found' },
      })
    }
    let zone: string | null = null
    const branch =
      typeof parent.branch === 'string' && parent.branch !== '' ? parent.branch : null
    if (branch) {
      const branchRow = await findScopedItem<Record<string, unknown>>(
        event,
        scope,
        'branches',
        branch,
        { fields: ['zone'] },
      ).catch(() => null)
      const raw = branchRow?.zone
      zone = typeof raw === 'string' && raw.length > 0 ? raw : null
    }
    const created = await createItem<Record<string, unknown>>(
      event,
      scope,
      'event_collaborators',
      {
        event: id,
        person: form.person,
        branch,
        zone,
        areas: form.areas,
        created_by: scope.session.user.id,
      },
    )
    return { data: created }
  } catch (error) {
    if ((error as { statusCode?: number })?.statusCode) throw error
    if ((error as { code?: string })?.code === '23505') {
      throw createError({
        statusCode: 409,
        statusMessage: 'That person is already a collaborator on this event',
        data: { code: 'duplicate_collaborator' },
      })
    }
    throwStoreUnavailable(error, 'collaborator_store', '0060')
  }
})
