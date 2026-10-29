import {
  getPortalScope,
  listItems,
  mergeFilters,
  requireCan,
  throwStoreUnavailable,
} from '../../utils/portal'
import type { PortalScope } from '../../utils/portal'
import {
  buildTriggerChain,
  TRIGGER_UPON_JOINING_GROUP,
  type ChainStepInput,
} from '../../utils/trigger-chain'

/**
 * Trigger-chain preview reads (AFC-868, sample: Upon Joining a Group).
 *
 * Read-only: resolves one campaign by key plus its steps in sequence order,
 * enriches channel keys + template approval state (display-only, degrades
 * to raw ids like the campaign detail), and returns the preview chain.
 * No enrollment, contact, or recipient row is ever selected here.
 *
 * Permission + scope contract (smallest defensible, stated for review):
 * - Gate: `communications` read — the same proxy grant as the campaign
 *   catalogue/detail (no new capability invented).
 * - Branch scope mirrors the campaign reads: area staff read everything;
 *   branch staff read their own branches plus area-wide rows.
 *
 * Failure shape (AFC-550 pattern): a refused/missing store maps to the
 * named store error, never a bare 500; an unknown key is a 404 with a
 * stable code the UI can explain.
 */

const CAMPAIGN_PREVIEW_FIELDS = [
  'id',
  'key',
  'name',
  'consent_policy',
  'status',
  'branch',
  'quiet_hours_override',
]

const STEP_PREVIEW_FIELDS = [
  'id',
  'campaign',
  'sequence',
  'name',
  'delay_type',
  'delay_value',
  'channel',
  'template',
  'condition',
  'is_entry_step',
  'is_fallback_step',
  'active',
]

function campaignScope(scope: PortalScope) {
  if (scope.isArea) return undefined
  return mergeFilters({
    _or: [{ branch: { _in: scope.branchIds } }, { branch: { _null: true } }],
  })
}

function parseAnchor(value: unknown): Date {
  if (typeof value === 'string' && value.length > 0) {
    const parsed = new Date(value)
    if (!Number.isNaN(parsed.getTime())) return parsed
  }
  return new Date()
}

export default defineEventHandler(async (event) => {
  const scope = await getPortalScope(event)
  requireCan(scope, 'communications', 'read')

  const query = getQuery(event)
  const key =
    typeof query.key === 'string' && query.key.trim() !== ''
      ? query.key.trim()
      : 'new_visitor_welcome_drip'
  const anchor = parseAnchor(query.anchor)

  let campaignRows: Record<string, unknown>[]
  let stepRows: Record<string, unknown>[]
  try {
    const campaigns = await listItems<Record<string, unknown>>(
      event,
      scope,
      'campaigns',
      {
        filter: mergeFilters(campaignScope(scope), { key: { _eq: key } }),
        fields: CAMPAIGN_PREVIEW_FIELDS,
        limit: 2,
      },
    )
    campaignRows = campaigns.data

    stepRows = []
    const owner = campaignRows[0]
    if (owner) {
      const steps = await listItems<Record<string, unknown>>(
        event,
        scope,
        'campaign_steps',
        {
          filter: { campaign: { _eq: String(owner.id) } },
          fields: STEP_PREVIEW_FIELDS,
          sort: 'sequence',
          limit: -1,
        },
      )
      stepRows = steps.data
    }
  } catch (error) {
    throwStoreUnavailable(error, 'campaign_store', '0006')
  }

  const campaign = campaignRows.length === 1 ? campaignRows[0] : undefined
  if (!campaign) {
    throw createError({
      statusCode: 404,
      statusMessage: `No trigger chain for campaign key '${key}'`,
      data: { code: 'trigger_chain_unknown_campaign' },
    })
  }

  // Channel keys + template approval state: display enrichment only, so an
  // unreadable collection degrades to the raw-id display (AFC-550 detail
  // rule) instead of failing the whole preview.
  const channelIds = [...new Set(stepRows.map((s) => String(s.channel)).filter(Boolean))]
  const channelById = new Map<string, { key: string; enabled: boolean }>()
  if (channelIds.length > 0) {
    const channels = await listItems<Record<string, unknown>>(
      event,
      scope,
      'communication_channels',
      {
        filter: { id: { _in: channelIds } },
        fields: ['id', 'key', 'enabled'],
        limit: -1,
      },
    ).catch(() => null)
    for (const channel of channels?.data ?? []) {
      channelById.set(String(channel.id), {
        key: String(channel.key),
        enabled: channel.enabled === true,
      })
    }
  }

  const templateIds = [
    ...new Set(
      stepRows
        .map((s) => s.template)
        .filter((t) => t !== null && t !== undefined)
        .map(String),
    ),
  ]
  const templateById = new Map<
    string,
    { approval_status: string; provider_template_id: string | null }
  >()
  if (templateIds.length > 0) {
    const templates = await listItems<Record<string, unknown>>(
      event,
      scope,
      'message_templates',
      {
        filter: { id: { _in: templateIds } },
        fields: ['id', 'approval_status', 'provider_template_id'],
        limit: -1,
      },
    ).catch(() => null)
    for (const template of templates?.data ?? []) {
      templateById.set(String(template.id), {
        approval_status: String(template.approval_status),
        provider_template_id: (template.provider_template_id as string | null) ?? null,
      })
    }
  }

  const steps: ChainStepInput[] = stepRows.map((row) => {
    const channelId = String(row.channel)
    const templateId =
      row.template === null || row.template === undefined ? null : String(row.template)
    return {
      sequence: Number(row.sequence ?? 0),
      name: String(row.name ?? ''),
      delay_type: String(row.delay_type ?? ''),
      delay_value: (row.delay_value as string | null) ?? null,
      channel_key: channelById.get(channelId)?.key ?? channelId,
      channel_enabled: channelById.get(channelId)?.enabled ?? null,
      template_approval_status:
        templateId === null
          ? null
          : (templateById.get(templateId)?.approval_status ?? 'unknown'),
      template_provider_id:
        templateId === null
          ? null
          : (templateById.get(templateId)?.provider_template_id ?? null),
      is_entry_step: row.is_entry_step === true,
      active: row.active !== false,
    }
  })

  const chain = buildTriggerChain({
    campaign_key: String(campaign.key),
    campaign_name: String(campaign.name),
    consent_policy: String(campaign.consent_policy ?? ''),
    campaign_status: String(campaign.status ?? ''),
    quiet_hours_override: campaign.quiet_hours_override === true,
    steps,
    anchor,
  })

  return {
    data: {
      ...chain,
      trigger: TRIGGER_UPON_JOINING_GROUP,
    },
  }
})
