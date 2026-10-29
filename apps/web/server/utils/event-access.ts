import type { H3Event } from 'h3'
import { can, findScopedItem, listItems, type PortalScope } from './portal'

/**
 * Event collaborators (AFC-880): per-event delegation with per-area grants.
 *
 * A scoped write passes when the caller's role grant passes (unchanged) OR
 * the caller is a collaborator on that event whose areas include the
 * write's area. Reads are unchanged. Areas in v1: details, schedule,
 * speakers, resources, budget, registration. Tasks are deliberately not
 * an area: tasks attach to branches/people, not events, so a per-event
 * task grant would be unenforceable decoration.
 *
 * Fail-closed throughout: no session user, no row, or a denied read of
 * the register all mean "not a collaborator" and the route falls back to
 * its role gate (which then refuses with its own 403).
 */
export const COLLABORATOR_AREAS = [
  'details',
  'schedule',
  'speakers',
  'resources',
  'budget',
  'registration',
] as const

export type CollaboratorArea = (typeof COLLABORATOR_AREAS)[number]

export function isCollaboratorArea(value: unknown): value is CollaboratorArea {
  return (
    typeof value === 'string' && (COLLABORATOR_AREAS as readonly string[]).includes(value)
  )
}

/** Body keys that belong to a section area on PATCH /api/events/:id. */
const SECTION_KEY_AREAS: Record<string, CollaboratorArea> = {
  speakers: 'speakers',
  speakers_visibility: 'speakers',
  resources: 'resources',
  resources_visibility: 'resources',
  schedule: 'schedule',
  schedule_visibility: 'schedule',
  registration_visibility: 'registration',
}

/**
 * Areas a PATCH body requires. Unknown keys are details: a collaborator
 * who can only touch sections must not rename the programme.
 */
export function areasForEventPatch(body: Record<string, unknown>): CollaboratorArea[] {
  const needed = new Set<CollaboratorArea>()
  for (const key of Object.keys(body)) {
    needed.add(SECTION_KEY_AREAS[key] ?? 'details')
  }
  return [...needed]
}

/** Collaborator areas the session user holds on one event (empty = none). */
export async function collaboratorAreas(
  event: H3Event,
  scope: PortalScope,
  eventId: string,
): Promise<string[]> {
  const userId: unknown = scope.session.user.id
  if (typeof userId !== 'string' || userId === '') return []
  try {
    const rows = await listItems<{ areas: unknown }>(
      event,
      scope,
      'event_collaborators',
      {
        filter: { event: { _eq: eventId }, person: { _eq: userId } },
        fields: ['areas'],
        limit: 1,
      },
    )
    const areas = rows.data[0]?.areas
    if (!Array.isArray(areas)) return []
    return areas.filter((area): area is string => typeof area === 'string')
  } catch {
    return []
  }
}

/**
 * Whether the session user is a collaborator holding an area on an event.
 * Fail-closed: anything unreadable means no.
 */
export async function collaboratorHasArea(
  event: H3Event,
  scope: PortalScope,
  eventId: string,
  area: CollaboratorArea,
): Promise<boolean> {
  const areas = await collaboratorAreas(event, scope, eventId)
  return areas.includes(area)
}

/**
 * Require one collaborator area on an event, unless the caller's role
 * already grants the fallback action. Throws 403 naming the missing area.
 */
export async function requireEventArea(
  event: H3Event,
  scope: PortalScope,
  eventId: string,
  area: CollaboratorArea,
  fallback: { collection: string; action: 'create' | 'read' | 'update' | 'delete' },
): Promise<void> {
  if (can(scope, fallback.collection, fallback.action)) return
  try {
    await findScopedItem(event, scope, 'events', eventId, { fields: ['id'] })
  } catch {
    throw createError({
      statusCode: 403,
      statusMessage: `Your role cannot change ${area} on this event`,
      data: { code: 'forbidden', area },
    })
  }
  const areas = await collaboratorAreas(event, scope, eventId)
  if (!areas.includes(area)) {
    throw createError({
      statusCode: 403,
      statusMessage: `Your role cannot change ${area} on this event`,
      data: { code: 'forbidden', area },
    })
  }
}
