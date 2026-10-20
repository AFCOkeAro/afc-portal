import { createItem, getPortalScope } from '../../utils/portal'
import {
  COST_CHANNELS,
  COST_CURRENCIES,
  HARDENING_COLLECTIONS,
  canPublishRates,
  estimateRunCost,
} from '../../utils/hardening'

/**
 * Campaign rate card (AFC-486, cost reporting).
 *
 * GET returns the current per-channel unit costs (the rate procurement sets,
 * I4). POST publishes a rate — area admin only, because the owner of every
 * naira of SMS/provider spend is the area admin (ADR-0009 consequence).
 * A NULL unit cost means "unset" and is reported as unset, never as zero:
 * estimateRunCost() raises on NULL rather than pricing a run at nothing.
 *
 * The per-run cost itself lives on the sibling run rows (estimated before
 * send, actual after, US-C2 AC1); this route owns the card the estimate is
 * computed from, never a second cost column.
 */

export default defineEventHandler(async (event) => {
  const scope = await getPortalScope(event)

  // POST: publish a rate (area admin only).
  if (!canPublishRates(scope.role)) {
    throw createError({
      statusCode: 403,
      statusMessage: 'Only the area admin publishes the rate card (owner of every naira)',
      data: { code: 'cost_owner_area_admin' },
    })
  }
  const body = await readBody<{ channel?: unknown; unit_cost?: unknown; currency?: unknown }>(event)
  const channel = typeof body.channel === 'string' ? body.channel : ''
  if (!(COST_CHANNELS as readonly string[]).includes(channel)) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Channel must be one of whatsapp, sms, email',
      data: { code: 'channel_required' },
    })
  }
  const unitCost = typeof body.unit_cost === 'number' ? body.unit_cost : Number.NaN
  // Validated through the same pure rule the estimate uses: negative rates
  // are rejected before they reach the database CHECK.
  estimateRunCost(1, unitCost)
  const currency = typeof body.currency === 'string' ? body.currency : 'NGN'
  if (!(COST_CURRENCIES as readonly string[]).includes(currency)) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Currency must be one of NGN, USD, GBP',
      data: { code: 'currency_invalid' },
    })
  }
  try {
    const row = await createItem<{ id: string }>(event, scope, HARDENING_COLLECTIONS.costRates, {
      channel,
      unit_cost: unitCost,
      currency,
    })
    return { published: true, id: row.id, channel, unit_cost: unitCost, currency }
  } catch (error) {
    throw createError({
      statusCode: 503,
      statusMessage: 'Rate-card store unavailable (migration 0015 not applied?)',
      data: { code: 'pending_migration_0015', cause: String(error) },
    })
  }
})
