import { requireSuperAdmin } from '../../../utils/admin-guard'
import { runDemoClear } from '../../../utils/demo-admin'

/**
 * POST /api/admin/demo/clear — remove the linked demo dataset (AFC-1086).
 *
 * Super-admin only, and the body must carry the exact confirmation phrase
 * `{ confirmPhrase: 'DELETE DEMO DATA' }` -- anything else is a 400 and
 * nothing runs. Removes only registry-planted rows (child-to-parent, with
 * the DEMO- fallback on natural-key tables), refuses sealed registers,
 * writes a `demo_admin_actions` row with the actor and removed counts, and
 * reports them. Safe on empty; a second run reports zero counts.
 */
export default defineEventHandler(async (event) => {
  const scope = await requireSuperAdmin(event)
  const body = await readBody(event).catch(() => null)
  try {
    const counts = await runDemoClear(
      event,
      scope.session.user.id,
      (body as { confirmPhrase?: unknown } | null)?.confirmPhrase,
    )
    return { ok: true, action: 'clear', total: counts.total, tables: counts.tables }
  } catch (cause) {
    if (cause && typeof cause === 'object' && 'statusCode' in cause) throw cause
    throw createError({
      statusCode: 503,
      statusMessage: 'Demo clearing is unavailable right now',
      data: { code: 'demo_unavailable' },
    })
  }
})
