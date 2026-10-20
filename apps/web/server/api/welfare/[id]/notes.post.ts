import { welfareNoteFormSchema } from '@afc/shared'
import {
  createItem,
  findScopedItem,
  getPortalScope,
  requireCan,
  throwValidation,
} from '../../../utils/portal'

/**
 * Append a freeform case note (AFC-472). The note lands on
 * welfare_case_events as event_type `note`: `detail` is the short timeline
 * summary, `body` the long freeform text, and the audit actor is auto-set
 * to the session user -- the caller never names an actor.
 *
 * Gate choice, stated: this route requires welfare_cases *read* (scoped to
 * the case), not update. A note appends to the audit trail; it never
 * mutates the case row, so a reader with youth-case visibility can record
 * what they saw. The Directus policy remains the authoritative control
 * (data-model §9); confinement to the caller's scope is enforced twice --
 * here by findScopedItem, there by the policy filter.
 */
export default defineEventHandler(async (event) => {
  const scope = await getPortalScope(event)
  requireCan(scope, 'welfare_cases', 'read')

  const id = getRouterParam(event, 'id')
  if (!id) throw createError({ statusCode: 400, statusMessage: 'A case id is required' })
  await findScopedItem(event, scope, 'welfare_cases', id, { fields: ['id'] })

  const parsed = welfareNoteFormSchema.safeParse(await readBody(event))
  if (!parsed.success) throwValidation(parsed.error)

  const now = new Date().toISOString()
  const summary = parsed.data.detail ?? parsed.data.body!.slice(0, 200)
  const created = await createItem<Record<string, unknown>>(
    event,
    scope,
    'welfare_case_events',
    {
      case: id,
      event_type: 'note',
      detail: summary,
      summary,
      body: parsed.data.body ?? null,
      actor_user: scope.session.user.id,
      actor: scope.session.user.id,
      created_at: now,
    },
  )

  return { data: { ...created, id: String(created.id) } }
})
