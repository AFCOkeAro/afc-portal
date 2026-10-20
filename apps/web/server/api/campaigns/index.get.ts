import {
  getPortalScope,
  listItems,
  mergeFilters,
  requireCan,
} from '../../utils/portal'
import type { PortalScope } from '../../utils/portal'

/**
 * Campaign catalogue reads (AFC-527, US-C1 + US-C5).
 *
 * Read-only: this slice adds no send, enqueue, pause or resume path. The
 * single-action kill switch stays `POST /api/hardening/pause-all`; this
 * route only reports the status that switch acts on.
 *
 * Permission + scope contract (smallest defensible, stated for review):
 * - Gate: `communications` read. The campaigns tables carry no collection
 *   row in the shared matrix yet, and the catalogue readers are exactly the
 *   delivery-log readers (branch admin and above), so the log grant is the
 *   proxy. No new capability is invented here.
 * - Branch scope mirrors the events rule: area staff see everything; branch
 *   staff see their own branches plus area-wide rows (`branch IS NULL`).
 *   Enrollments (which carry `contact_key`, area/super reads only) are never
 *   selected here.
 */

export const CAMPAIGN_FIELDS = [
  'id',
  'key',
  'name',
  'purpose',
  'campaign_type',
  'consent_policy',
  'status',
  'branch',
  'zone',
  'max_sends_per_person_per_week',
  'fallback_sms_after_hours',
  'quiet_hours_override',
  'timezone',
  'version',
  'activated_at',
  'paused_at',
  'paused_by',
  'pause_reason',
  'updated_at',
]

const CAMPAIGN_STATUSES = ['draft', 'active', 'paused', 'archived']

export interface CampaignListRow {
  id: string
  key: string
  name: string
  purpose: string
  campaign_type: string
  consent_policy: string
  status: string
  branch: string | null
  zone: string | null
  step_count: number
  last_run: {
    id: string
    status: string
    window_start: string | null
    sent_count: number
    delivered_count: number
    failed_count: number
  } | null
}

function campaignScope(scope: PortalScope) {
  if (scope.isArea) return undefined
  return {
    _or: [{ branch: { _in: scope.branchIds } }, { branch: { _null: true } }],
  }
}

export default defineEventHandler(async (event) => {
  const scope = await getPortalScope(event)
  requireCan(scope, 'communications', 'read')

  const query = getQuery(event)
  const status =
    typeof query.status === 'string' && CAMPAIGN_STATUSES.includes(query.status)
      ? query.status
      : undefined

  const result = await listItems<Record<string, unknown>>(event, scope, 'campaigns', {
    filter: mergeFilters(
      campaignScope(scope),
      status ? { status: { _eq: status } } : undefined,
    ),
    fields: CAMPAIGN_FIELDS,
    sort: 'key',
    limit: -1,
  })

  const ids = result.data.map((row) => String(row.id))

  // Step counts (one query, no enrollment/contact reads).
  const stepCounts = new Map<string, number>()
  if (ids.length > 0) {
    const steps = await listItems<{ campaign: string }>(event, scope, 'campaign_steps', {
      filter: { campaign: { _in: ids } },
      fields: ['campaign'],
      limit: -1,
    })
    for (const step of steps.data) {
      const key = String(step.campaign)
      stepCounts.set(key, (stepCounts.get(key) ?? 0) + 1)
    }
  }

  // Latest run per campaign (one query, newest first, first row wins).
  const lastRunByCampaign = new Map<string, CampaignListRow['last_run']>()
  if (ids.length > 0) {
    const runs = await listItems<Record<string, unknown>>(event, scope, 'campaign_runs', {
      filter: { campaign: { _in: ids } },
      fields: [
        'id',
        'campaign',
        'status',
        'window_start',
        'sent_count',
        'delivered_count',
        'failed_count',
      ],
      sort: '-window_start',
      limit: 200,
    })
    for (const run of runs.data) {
      const key = String(run.campaign)
      if (!lastRunByCampaign.has(key)) {
        lastRunByCampaign.set(key, {
          id: String(run.id),
          status: String(run.status),
          window_start: (run.window_start as string | null) ?? null,
          sent_count: Number(run.sent_count ?? 0),
          delivered_count: Number(run.delivered_count ?? 0),
          failed_count: Number(run.failed_count ?? 0),
        })
      }
    }
  }

  const rows: CampaignListRow[] = result.data.map((row) => ({
    id: String(row.id),
    key: String(row.key),
    name: String(row.name),
    purpose: String(row.purpose),
    campaign_type: String(row.campaign_type),
    consent_policy: String(row.consent_policy),
    status: String(row.status),
    branch: (row.branch as string | null) ?? null,
    zone: (row.zone as string | null) ?? null,
    step_count: stepCounts.get(String(row.id)) ?? 0,
    last_run: lastRunByCampaign.get(String(row.id)) ?? null,
  }))

  return { data: rows }
})
