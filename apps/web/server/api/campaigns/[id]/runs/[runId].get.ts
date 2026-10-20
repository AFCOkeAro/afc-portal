import {
  findScopedItem,
  getPortalScope,
  requireCan,
  throwStoreUnavailable,
} from '../../../../utils/portal'

/**
 * Campaign run report reads (AFC-527, US-C2, wireframes v3 screen 12).
 *
 * Read-only: the auditable batch record for one step execution window —
 * audience / eligible / excluded (by reason) / queued / sent / delivered /
 * read / failed / opted-out / cost, plus the run `notes` stating which
 * activity signals were available (OQ-R5: `delivered` is the proxy when the
 * provider supplies no read receipts). No retry or requeue lives here; the
 * single idempotent retry for failed invite sends is the invites route.
 *
 * Scope follows the campaign, not the run: area staff read any run, branch
 * staff read runs of their own branches plus area-wide campaigns.
 */

const RUN_FIELDS = [
  'id',
  'campaign',
  'campaign_version',
  'step',
  'window_start',
  'window_end',
  'trigger',
  'status',
  'audience_size',
  'eligible_count',
  'excluded_count',
  'excluded_reasons',
  'queued_count',
  'sent_count',
  'delivered_count',
  'read_count',
  'failed_count',
  'opted_out_count',
  'estimated_cost',
  'actual_cost',
  'currency',
  'communication',
  'worker_run_id',
  'started_at',
  'completed_at',
  'notes',
]

export default defineEventHandler(async (event) => {
  const scope = await getPortalScope(event)
  requireCan(scope, 'communications', 'read')

  const id = getRouterParam(event, 'id')
  const runId = getRouterParam(event, 'runId')
  if (!id)
    throw createError({ statusCode: 400, statusMessage: 'A campaign id is required' })
  if (!runId)
    throw createError({ statusCode: 400, statusMessage: 'A run id is required' })

  // The campaign read is the scope gate: a branch session that cannot read
  // the campaign cannot read its runs either. AFC-550: both reads hit 0006
  // collections — map store failures to the named error, never a bare 500.
  // The step-name lookup below stays best-effort (unknown step → null name).
  let campaign: Record<string, unknown>
  let run: Record<string, unknown>
  try {
    campaign = await findScopedItem<Record<string, unknown>>(
      event,
      scope,
      'campaigns',
      id,
      {
        fields: ['id', 'key', 'name', 'status', 'branch', 'consent_policy'],
        scope: scope.isArea
          ? undefined
          : {
              _or: [{ branch: { _in: scope.branchIds } }, { branch: { _null: true } }],
            },
      },
    )

    run = await findScopedItem<Record<string, unknown>>(
      event,
      scope,
      'campaign_runs',
      runId,
      { fields: RUN_FIELDS },
    )
  } catch (error) {
    throwStoreUnavailable(error, 'campaign_store', '0006')
  }
  if (String(run.campaign) !== String(campaign.id)) {
    throw createError({
      statusCode: 404,
      statusMessage: 'That run does not belong to this campaign',
      data: { code: 'run_campaign_mismatch' },
    })
  }

  let stepName: string | null = null
  if (run.step) {
    const step = await findScopedItem<Record<string, unknown>>(
      event,
      scope,
      'campaign_steps',
      String(run.step),
      { fields: ['id', 'name', 'sequence'] },
    ).catch(() => null)
    stepName = step ? String(step.name) : null
  }

  return {
    data: {
      ...(run as Record<string, unknown>),
      id: String(run.id),
      campaign_key: String(campaign.key),
      campaign_name: String(campaign.name),
      campaign_status: String(campaign.status),
      campaign_consent_policy: String(campaign.consent_policy),
      step_name: stepName,
    },
  }
})
