import {
  can,
  countItems,
  getPortalScope,
  listItems,
  requireCan,
} from '../../utils/portal'
import {
  HARDENING_COLLECTIONS,
  MONITOR_CHECK_KEYS,
  tickSloRatio,
  type MonitorCheckKey,
} from '../../utils/hardening'

/**
 * Hardening status (AFC-486, hardening_monitoring Flow).
 *
 * Read surface for the monitoring checks: latest monitor outcome per key,
 * the rate card, the tick SLO share measured over the monitor log, and the
 * queue depth (due-but-unprocessed enrollments). Permission-scoped: staff
 * with a communications read grant see it; branch staff see their own slice
 * note (the monitor log carries no branch column by design — checks are
 * area-wide, and branch staff read the shared outcome, never another
 * branch's rows).
 *
 * Tolerant reader: when migration 0015 is not applied yet (or the sibling
 * campaign tables are absent), the missing piece reports null with a
 * pending_migration note instead of failing the whole status. A status page
 * that 500s on a missing table is a monitor that needs monitoring.
 */

interface MonitorRow {
  id: string
  check_key: MonitorCheckKey
  ok: boolean
  detail: string | null
  recorded_at: string
}

interface RateRow {
  channel: string
  unit_cost: number | null
  currency: string
  effective_from: string
}

async function latestPerKey(
  event: Parameters<typeof listItems>[0],
  scope: Parameters<typeof listItems>[1],
): Promise<{ rows: Partial<Record<MonitorCheckKey, MonitorRow>>; pending: boolean }> {
  const rows = {} as Partial<Record<MonitorCheckKey, MonitorRow>>
  try {
    const result = await listItems<MonitorRow>(event, scope, HARDENING_COLLECTIONS.monitorChecks, {
      fields: ['id', 'check_key', 'ok', 'detail', 'recorded_at'],
      sort: '-recorded_at',
      limit: 50,
    })
    for (const row of result.data) {
      if (!rows[row.check_key]) rows[row.check_key] = row
    }
    return { rows, pending: false }
  } catch {
    return { rows, pending: true }
  }
}

export default defineEventHandler(async (event) => {
  const scope = await getPortalScope(event)
  requireCan(scope, 'communications', 'read')

  const { rows: latest, pending } = await latestPerKey(event, scope)

  let rates: RateRow[] | null = null
  let ratesPending = false
  try {
    const result = await listItems<RateRow>(event, scope, HARDENING_COLLECTIONS.costRates, {
      fields: ['channel', 'unit_cost', 'currency', 'effective_from'],
      sort: 'channel',
      limit: 10,
    })
    rates = result.data
  } catch {
    ratesPending = true
  }

  // Queue depth: due-but-unprocessed enrollments. The campaign tables belong
  // to slice 4c (0006); when they are absent the depth is unknown, not zero
  // — reporting zero would claim the tick is idle when it may not exist.
  let queueDepth: number | null = null
  try {
    queueDepth = await countItems(event, scope, 'campaign_enrollments', {
      state: { _eq: 'active' },
      next_step_at: { _lte: '$NOW' },
    })
  } catch {
    queueDepth = null
  }

  // Tick SLO share over the recent tick_slo checks (pass ratio, not a guess).
  let sloRatio: number | null = null
  try {
    const result = await listItems<MonitorRow>(event, scope, HARDENING_COLLECTIONS.monitorChecks, {
      filter: { check_key: { _eq: 'tick_slo' } },
      fields: ['ok'],
      limit: 100,
    })
    if (result.data.length > 0) {
      const met = result.data.filter((row) => row.ok).length
      sloRatio = tickSloRatio(met, result.data.length)
    }
  } catch {
    sloRatio = null
  }

  return {
    checks: MONITOR_CHECK_KEYS.map((key) => ({
      key,
      ok: latest[key]?.ok ?? null,
      detail: latest[key]?.detail ?? null,
      recorded_at: latest[key]?.recorded_at ?? null,
    })),
    queue_depth: queueDepth,
    tick_slo_ratio: sloRatio,
    rates,
    can_publish_rates: can(scope, 'communications', 'create') && scope.isArea,
    pending_migration_0015: pending || ratesPending,
  }
})
