import { createItem, getPortalScope, listItems, updateItem } from '../../utils/portal'
import { HARDENING_COLLECTIONS, hardeningAlert } from '../../utils/hardening'

/**
 * Pause-all single action (AFC-525 Q2, US-C5).
 *
 * One POST pauses every active campaign and — when asked — disables the
 * affected channel(s), then logs `pause_drill` to `hardening_monitor_checks`
 * and returns the staff-channel announcement (ids + counts only, never
 * message content). This is the single action the acceptance needs; the
 * runbook's two manual steps remain documented as what this route does.
 *
 * Kill-switch semantics (ADR-0009 decision 4, 0006): `status = paused` holds
 * pending enrollments — rows stay (`state = paused`), nothing queued is
 * deleted, and the very next tick excludes them via
 * `campaign_due_enrollments`. Resume is `status = active`; enrollments
 * resume from `next_step_at` (send-key UNIQUE, US-C2 AC2).
 *
 * Enforcement: area admin only (runbook owner). No new service, secret, or
 * dependency: reads/writes go through the portal Directus helpers on tables
 * this slice owns, and the announcement reuses `hardeningAlert`.
 */

interface PauseAllBody {
  reason?: unknown
  disable_channels?: unknown
  channel?: unknown
}

const CHANNEL_KEYS = ['whatsapp', 'sms', 'email'] as const

export default defineEventHandler(async (event) => {
  const scope = await getPortalScope(event)
  if (!scope.isArea) {
    throw createError({
      statusCode: 403,
      statusMessage: 'Only the area admin pauses all campaigns (runbook owner)',
      data: { code: 'pause_owner_area_admin' },
    })
  }

  const body = await readBody<PauseAllBody>(event).catch(() => ({}) as PauseAllBody)
  const reason =
    typeof body.reason === 'string' && body.reason.trim().length > 0
      ? body.reason.trim().slice(0, 280)
      : 'suspected wrong template — pause-all single action (AFC-525)'
  const disableChannels =
    body.disable_channels === true || body.disable_channels === 'true'
  const onlyChannel =
    typeof body.channel === 'string' &&
    (CHANNEL_KEYS as readonly string[]).includes(body.channel)
      ? body.channel
      : null

  let campaigns: Array<{ id: string | number; key?: string }>
  try {
    const result = await listItems<{ id: string | number; key?: string }>(
      event,
      scope,
      'campaigns',
      {
        filter: { status: { _eq: 'active' } },
        fields: ['id', 'key', 'status'],
        limit: -1,
      },
    )
    campaigns = result.data
  } catch (error) {
    throw createError({
      statusCode: 503,
      statusMessage: 'Campaign store unavailable (migration 0006 not applied?)',
      data: { code: 'pending_migration_0006', cause: String(error) },
    })
  }

  const now = new Date().toISOString()
  const pausedIds: string[] = []
  for (const row of campaigns) {
    const id = String(row.id)
    try {
      await updateItem(event, scope, 'campaigns', id, {
        status: 'paused',
        paused_at: now,
        paused_by: scope.session.user.id,
        pause_reason: reason,
      })
      pausedIds.push(id)
    } catch (error) {
      throw createError({
        statusCode: 503,
        statusMessage: 'Could not pause campaigns (Directus write failed)',
        data: { code: 'pause_failed', cause: String(error) },
      })
    }
  }

  const disabledChannels: string[] = []
  if (disableChannels) {
    try {
      const channels = await listItems<{
        id: string | number
        key: string
        enabled: boolean
      }>(event, scope, 'communication_channels', {
        fields: ['id', 'key', 'enabled'],
        limit: -1,
      })
      const targets = channels.data.filter((row) =>
        onlyChannel ? row.key === onlyChannel : row.enabled === true,
      )
      for (const row of targets) {
        await updateItem(event, scope, 'communication_channels', String(row.id), {
          enabled: false,
          notes: `pause-all ${now}: ${reason}`,
        })
        disabledChannels.push(row.key)
      }
    } catch (error) {
      throw createError({
        statusCode: 503,
        statusMessage:
          'Campaigns paused but channel disable failed — re-run with disable_channels',
        data: { code: 'channel_disable_failed', cause: String(error), paused: pausedIds },
      })
    }
  }

  const detail =
    `pause-all campaigns=${pausedIds.length}` +
    ` campaigns_ids=${pausedIds.slice(0, 10).join(',') || 'none'}` +
    ` channels_disabled=${disabledChannels.join(',') || 'none'}` +
    ` reason=${reason}` +
    ` actor=${scope.session.user.id}`

  let checkId: string | null
  try {
    const check = await createItem<{ id: string }>(
      event,
      scope,
      HARDENING_COLLECTIONS.monitorChecks,
      {
        check_key: 'pause_drill',
        ok: true,
        detail,
        recorded_by: scope.session.user.id,
      },
    )
    checkId = check.id
  } catch (error) {
    throw createError({
      statusCode: 503,
      statusMessage: 'Paused but the pause_drill log failed — record it before resuming',
      data: { code: 'pending_migration_0015', cause: String(error), paused: pausedIds },
    })
  }

  const announcement = hardeningAlert({
    kind: 'monitor_check',
    checkKey: 'pause_drill',
    counts: { paused: pausedIds.length, channels_disabled: disabledChannels.length },
    note: `pause-all check=${checkId} reason=${reason}`,
  })

  return {
    paused: pausedIds.length,
    paused_ids: pausedIds,
    channels_disabled: disabledChannels,
    pause_drill_check_id: checkId,
    announcement,
  }
})
