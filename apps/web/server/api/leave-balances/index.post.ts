import { leaveBalanceFormSchema } from '@afc/shared'
import {
  createItem,
  findScopedItem,
  getPortalScope,
  listItems,
  requireCan,
  throwStoreUnavailable,
  throwValidation,
} from '../../utils/portal'

/**
 * POST /api/leave-balances — set an annual allowance (AFC-854 phase 1).
 * Branch/zone stamp from the person row at write time (0044 choice-8).
 */
export default defineEventHandler(async (event) => {
  const scope = await getPortalScope(event)
  requireCan(scope, 'leave_balances', 'create')

  try {
    const parsed = leaveBalanceFormSchema.safeParse(await readBody(event))
    if (!parsed.success) throwValidation(parsed.error)
    const form = parsed.data

    const person = await findScopedItem<Record<string, unknown>>(
      event,
      scope,
      'people',
      form.person,
      { fields: ['id', 'branch', 'zone'] },
    )
    const branch =
      typeof person.branch === 'string' && person.branch !== '' ? person.branch : null
    let zone: string | null = typeof person.zone === 'string' ? person.zone : null
    if (branch && !zone) {
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
        'leave_balances',
        {
          person: form.person,
          year: form.year,
          allowance_days: form.allowance_days,
          branch,
          zone,
          created_by: scope.session.user.id,
        },
      )
      return { data: { ...created, id: String(created.id) } }
    } catch (error) {
      if ((error as { statusCode?: number })?.statusCode) throw error
      throw createError({
        statusCode: 400,
        statusMessage: 'That person already has an allowance for this year',
        data: { code: 'duplicate_allowance' },
      })
    }
  } catch (error) {
    if ((error as { statusCode?: number })?.statusCode) throw error
    throwStoreUnavailable(error, 'leave_store', '0055')
  }
})
