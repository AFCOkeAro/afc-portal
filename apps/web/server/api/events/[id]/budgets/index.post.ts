import { budgetFormSchema, toBudgetPayload } from '@afc/shared'
import {
  can,
  createItem,
  eventScopeFilter,
  findScopedItem,
  getPortalScope,
  listItems,
  throwStoreUnavailable,
  throwValidation,
} from '../../../../utils/portal'
import { collaboratorHasArea } from '../../../../utils/event-access'

/**
 * POST /api/events/:id/budgets — record a planned line against an event
 * (AFC-825). Append-only like expenses: a revised plan is a new row and
 * the GET resolves the latest per category, so there is no PUT/PATCH.
 *
 * Either grant opens the path (same posture as the expense create):
 * `events` update (the programme owner planning their own books) OR
 * `event_budgets` create (the finance recorder). The event must be in
 * scope; the category must exist in the expense_categories register
 * (unknown keys 400, inactive keys 400); recorded_by is the session user.
 */
export default defineEventHandler(async (event) => {
  const scope = await getPortalScope(event)
  const collaboratorEvent = getRouterParam(event, 'id')
  const collaboratorOk = collaboratorEvent
    ? await collaboratorHasArea(event, scope, collaboratorEvent, 'budget')
    : false
  if (!can(scope, 'events', 'update') && !can(scope, 'event_budgets', 'create')) {
    if (!collaboratorOk)
      throw createError({
        statusCode: 403,
        statusMessage: 'Your role cannot plan budgets on this event',
        data: { code: 'forbidden' },
      })
  }

  const id = getRouterParam(event, 'id')
  if (!id)
    throw createError({ statusCode: 400, statusMessage: 'An event id is required' })

  const body = ((await readBody(event)) ?? {}) as Record<string, unknown>
  const parsed = budgetFormSchema.safeParse(body)
  if (!parsed.success) throwValidation(parsed.error)
  const form = parsed.data

  try {
    await findScopedItem<Record<string, unknown>>(event, scope, 'events', id, {
      fields: ['id', 'branch'],
      scope: eventScopeFilter(scope),
    })

    const categories = await listItems<{ key: string; active: boolean }>(
      event,
      scope,
      'expense_categories',
      {
        filter: { key: { _eq: form.category_key } },
        fields: ['key', 'active'],
        limit: 1,
      },
    )
    const category = categories.data[0]
    if (!category) {
      throw createError({
        statusCode: 400,
        statusMessage: 'That budget category is not on record',
        data: {
          code: 'unknown_category',
          fields: { category_key: 'Pick a listed category' },
        },
      })
    }
    if (!category.active) {
      throw createError({
        statusCode: 400,
        statusMessage: 'That budget category is retired',
        data: {
          code: 'category_inactive',
          fields: { category_key: 'Pick an active category' },
        },
      })
    }

    const created = await createItem<Record<string, unknown>>(
      event,
      scope,
      'event_budgets',
      {
        ...toBudgetPayload(form, {
          event: id,
          recordedBy: scope.session.user.id,
        }),
      },
    )

    return { data: { ...created, id: String(created.id) } }
  } catch (error) {
    if ((error as { statusCode?: number })?.statusCode) throw error
    throwStoreUnavailable(error, 'budget store', '0045')
  }
})
