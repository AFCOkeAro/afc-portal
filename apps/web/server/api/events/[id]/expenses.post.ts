import { expenseFormSchema, toExpensePayload } from '@afc/shared'
import {
  can,
  createItem,
  eventScopeFilter,
  findScopedItem,
  getPortalScope,
  listItems,
  throwStoreUnavailable,
  throwValidation,
} from '../../../utils/portal'

/**
 * POST /api/events/:id/expenses — record spend against an event (AFC-801).
 *
 * Either grant opens the path (AFC-801 contract): `events` update (the
 * programme owner correcting their own books) OR `event_expenses` create
 * (the finance recorder). The event must be in scope either way; the
 * branch/zone denorm is stamped from the parent event at write time, never
 * taken from the client, and `recorded_by` is the server session user.
 * Append-only: there is no PUT/PATCH/DELETE on this collection.
 */
export default defineEventHandler(async (event) => {
  const scope = await getPortalScope(event)
  if (!can(scope, 'events', 'update') && !can(scope, 'event_expenses', 'create')) {
    throw createError({
      statusCode: 403,
      statusMessage: 'Your role cannot record expenses on this event',
      data: { code: 'forbidden' },
    })
  }

  const id = getRouterParam(event, 'id')
  if (!id)
    throw createError({ statusCode: 400, statusMessage: 'An event id is required' })

  const body = ((await readBody(event)) ?? {}) as Record<string, unknown>
  const parsed = expenseFormSchema.safeParse(body)
  if (!parsed.success) throwValidation(parsed.error)

  // AFC-801: the scope-gate, the denorm lookups and the create below hit the
  // 0021 event register and the 0044 expense register. An unreadable store
  // maps to the named error, never a bare 500; deliberate 4xx (scope 404s,
  // validation) passes through untouched.
  try {
    const eventRow = await findScopedItem<Record<string, unknown>>(
      event,
      scope,
      'events',
      id,
      { fields: ['id', 'branch'], scope: eventScopeFilter(scope) },
    )

    const branch =
      typeof eventRow.branch === 'string' && eventRow.branch.length > 0
        ? eventRow.branch
        : null
    let zone: string | null = null
    if (branch) {
      const parent = await listItems<Record<string, unknown>>(event, scope, 'branches', {
        filter: { id: { _eq: branch } },
        fields: ['zone'],
        limit: 1,
      })
      const raw = parent.data[0]?.zone
      zone = typeof raw === 'string' && raw.length > 0 ? raw : null
    }

    const created = await createItem<Record<string, unknown>>(
      event,
      scope,
      'event_expenses',
      {
        ...toExpensePayload(parsed.data, {
          branch,
          zone,
          recordedBy: scope.session.user.id,
        }),
        event: id,
      },
    )

    return { data: { ...created, id: String(created.id) } }
  } catch (error) {
    if ((error as { statusCode?: number })?.statusCode) throw error
    throwStoreUnavailable(error, 'expense_store', '0044')
  }
})
