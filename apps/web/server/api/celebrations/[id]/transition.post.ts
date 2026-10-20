import { z } from 'zod'
import {
  CELEBRATION_STATUSES,
  isCelebrationTransitionAllowed,
  type CelebrationStatus,
} from '@afc/shared'
import {
  createItem,
  findScopedItem,
  getPortalScope,
  requireCan,
  throwValidation,
  updateItem,
  zoneScopeFilter,
} from '../../../utils/portal'

const transitionSchema = z.object({
  /** The lifecycle move. The graph is draft -> approved -> published -> archived. */
  to: z.enum(CELEBRATION_STATUSES),
  /** Replacement publish channels. Required when moving to published with none stored. */
  publish_channels: z.array(z.string().trim().min(1).max(40)).max(10).optional(),
})

/**
 * POST /api/celebrations/:id/transition — approve/publish/archive flow.
 *
 * The lifecycle is server-enforced: the move must be an edge of the
 * draft -> approved -> published -> archived graph (archived is terminal,
 * published returns nowhere). Publishing needs a channel: the shout-out
 * publish path writes publish_channels here (replacing the stored set when
 * provided), and a publish with no channel anywhere is a 400 -- the
 * `celebrations_published_needs_channel` CHECK is the second layer, not
 * the error message. Every move writes its matching celebration_events row
 * (approved/published/archived, or `note` for a draft return) with the
 * session user as actor. A cross-scope id is a 404, never a foreign move.
 */
export default defineEventHandler(async (event) => {
  const scope = await getPortalScope(event)
  requireCan(scope, 'celebrations', 'update')

  const id = getRouterParam(event, 'id')
  if (!id)
    throw createError({ statusCode: 400, statusMessage: 'A celebration id is required' })

  const parsed = transitionSchema.safeParse(await readBody(event))
  if (!parsed.success) throwValidation(parsed.error)
  const { to, publish_channels } = parsed.data

  const existing = await findScopedItem<Record<string, unknown>>(
    event,
    scope,
    'celebrations',
    id,
    {
      fields: ['id', 'status', 'publish_channels'],
      scope: scope.isArea
        ? {}
        : scope.zoneIds.length > 0
          ? zoneScopeFilter(scope)
          : { branch: { _in: scope.branchIds } },
    },
  )

  const from = existing.status as CelebrationStatus
  if (!isCelebrationTransitionAllowed(from, to)) {
    throw createError({
      statusCode: 400,
      statusMessage: `A celebration cannot move from ${from} to ${to}`,
      data: {
        code: 'illegal_transition',
        fields: {
          to: `Allowed from ${from}: ${from === 'archived' ? 'none (terminal)' : 'see the lifecycle'}`,
        },
      },
    })
  }

  const storedChannels = Array.isArray(existing.publish_channels)
    ? (existing.publish_channels as unknown[]).filter(
        (channel): channel is string => typeof channel === 'string' && channel.length > 0,
      )
    : []
  const channels = publish_channels ?? storedChannels
  if (to === 'published' && channels.length === 0) {
    throw createError({
      statusCode: 400,
      statusMessage:
        'Publishing needs at least one channel: a greeting that reaches nobody is not published',
      data: {
        code: 'validation_error',
        fields: { publish_channels: 'Choose at least one channel' },
      },
    })
  }

  const now = new Date().toISOString()
  const updated = await updateItem<Record<string, unknown>>(
    event,
    scope,
    'celebrations',
    id,
    {
      status: to,
      ...(publish_channels !== undefined ? { publish_channels } : {}),
      updated_at: now,
    },
  )

  await createItem(event, scope, 'celebration_events', {
    celebration: id,
    event_type: to === 'draft' ? 'note' : to,
    detail:
      to === 'published'
        ? `Shout-out published to ${channels.join(', ')}`
        : `Celebration moved from ${from} to ${to}`,
    actor_user: scope.session.user.id,
    created_at: now,
  })

  return { data: { ...updated, id: String(updated.id) } }
})
