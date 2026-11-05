import { requireSuperAdmin } from '../../../utils/admin-guard'
import { runDemoSeed } from '../../../utils/demo-admin'

/**
 * POST /api/admin/demo/seed — plant the linked demo dataset (AFC-1086).
 *
 * Super-admin only. Runs the versioned `001_demo_seed.sql` through the
 * staging `demoDatabaseUrl` connection and writes a `demo_admin_actions`
 * row with the actor and per-table row counts. Idempotent: re-running
 * plants zero new rows and reports the existing counts.
 */
export default defineEventHandler(async (event) => {
  const scope = await requireSuperAdmin(event)
  try {
    const counts = await runDemoSeed(event, scope.session.user.id)
    return { ok: true, action: 'seed', total: counts.total, tables: counts.tables }
  } catch (cause) {
    if (cause && typeof cause === 'object' && 'statusCode' in cause) throw cause
    throw createError({
      statusCode: 503,
      statusMessage: 'Demo seeding is unavailable right now',
      data: { code: 'demo_unavailable' },
    })
  }
})
