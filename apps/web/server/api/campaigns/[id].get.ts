import {
  findScopedItem,
  getPortalScope,
  listItems,
  mergeFilters,
  requireCan,
} from '../../utils/portal'
import type { PortalScope } from '../../utils/portal'
import { CAMPAIGN_FIELDS } from './index.get'

/**
 * Campaign detail reads (AFC-527, US-C1 + US-C2 + US-C5).
 *
 * Read-only: steps, channel/template approval state, recent runs and the
 * consent-gate preview below come from stored rows only. No audience
 * recompute, no send, no enqueue, no pause/resume is performed here.
 *
 * Consent-gate preview (US-C1 AC2): `eligible`/`excluded` counts with
 * exclusion reasons are taken from the latest stored run's
 * `eligible_count` / `excluded_count` / `excluded_reasons`. Before the
 * first run there is no audience to count, so the preview reports
 * `has_run: false` instead of inventing numbers.
 *
 * Scope: same rule as the catalogue — area staff read any campaign, branch
 * staff read their own branches plus area-wide (`branch IS NULL`) rows.
 */

const STEP_FIELDS = [
  'id',
  'campaign',
  'sequence',
  'name',
  'delay_type',
  'delay_value',
  'channel',
  'template',
  'condition',
  'max_sends_per_person',
  'is_entry_step',
  'is_fallback_step',
  'is_terminal',
  'active',
]

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
  'currency',
  'started_at',
  'completed_at',
  'notes',
]

export default defineEventHandler(async (event) => {
  const scope = await getPortalScope(event)
  requireCan(scope, 'communications', 'read')

  const id = getRouterParam(event, 'id')
  if (!id) throw createError({ statusCode: 400, statusMessage: 'A campaign id is required' })

  const campaign = await findScopedItem<Record<string, unknown>>(
    event,
    scope,
    'campaigns',
    id,
    {
      fields: CAMPAIGN_FIELDS,
      scope: campaignScope(scope),
    },
  )

  const steps = await listItems<Record<string, unknown>>(event, scope, 'campaign_steps', {
    filter: { campaign: { _eq: id } },
    fields: STEP_FIELDS,
    sort: 'sequence',
    limit: -1,
  })

  // Channel keys + template approval state for the US-C1 AC4 gate display.
  // Small tables, fetched once; unknown ids stay visible as ids, never hidden.
  const channelIds = [...new Set(steps.data.map((s: Record<string, unknown>) => String(s.channel)).filter(Boolean))]
  const channelById = new Map<string, { key: string, enabled: boolean }>()
  if (channelIds.length > 0) {
    const channels = await listItems<Record<string, unknown>>(
      event,
      scope,
      'communication_channels',
      { filter: { id: { _in: channelIds } }, fields: ['id', 'key', 'enabled'], limit: -1 },
    )
    for (const channel of channels.data) {
      channelById.set(String(channel.id), {
        key: String(channel.key),
        enabled: channel.enabled === true,
      })
    }
  }

  const templateIds = [...new Set(steps.data.map((s: Record<string, unknown>) => s.template).filter(Boolean).map(String))]
  const templateById = new Map<string, { key: string, approval_status: string, provider_template_id: string | null }>()
  if (templateIds.length > 0) {
    const templates = await listItems<Record<string, unknown>>(
      event,
      scope,
      'message_templates',
      {
        filter: { id: { _in: templateIds } },
        fields: ['id', 'key', 'approval_status', 'provider_template_id'],
        limit: -1,
      },
    )
    for (const template of templates.data) {
      templateById.set(String(template.id), {
        key: String(template.key),
        approval_status: String(template.approval_status),
        provider_template_id: (template.provider_template_id as string | null) ?? null,
      })
    }
  }

  const runs = await listItems<Record<string, unknown>>(event, scope, 'campaign_runs', {
    filter: { campaign: { _eq: id } },
    fields: RUN_FIELDS,
    sort: '-window_start',
    limit: 20,
  })

  const latest = runs.data[0] as Record<string, unknown> | undefined

  return {
    data: {
      ...(campaign as Record<string, unknown>),
      id: String(campaign.id),
      steps: steps.data.map((step: Record<string, unknown>) => {
        const channelId = String(step.channel)
        const templateId = step.template === null || step.template === undefined
          ? null
          : String(step.template)
        return {
          ...(step as Record<string, unknown>),
          id: String(step.id),
          channel_key: channelById.get(channelId)?.key ?? channelId,
          channel_enabled: channelById.get(channelId)?.enabled ?? null,
          template_key: templateId === null ? null : (templateById.get(templateId)?.key ?? templateId),
          template_approval_status: templateId === null
            ? null
            : (templateById.get(templateId)?.approval_status ?? 'unknown'),
          template_provider_id: templateId === null
            ? null
            : (templateById.get(templateId)?.provider_template_id ?? null),
        }
      }),
      runs: runs.data.map((run: Record<string, unknown>) => ({ ...(run as Record<string, unknown>), id: String(run.id) })),
      consent_gate_preview: latest
        ? {
          has_run: true,
          run_id: String(latest.id),
          window_start: (latest.window_start as string | null) ?? null,
          audience_size: Number(latest.audience_size ?? 0),
          eligible_count: Number(latest.eligible_count ?? 0),
          excluded_count: Number(latest.excluded_count ?? 0),
          excluded_reasons: (latest.excluded_reasons as Record<string, number>) ?? {},
        }
        : { has_run: false as const },
    },
  }
})

function campaignScope(scope: PortalScope) {
  if (scope.isArea) return undefined
  return mergeFilters({
    _or: [{ branch: { _in: scope.branchIds } }, { branch: { _null: true } }],
  })
}
