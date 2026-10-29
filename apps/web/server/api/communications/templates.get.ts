import { getPortalScope, listItems, requireCan } from '../../utils/portal'

/**
 * GET /api/communications/templates — message templates for the compose step
 * (AFC-904).
 *
 * Read-only list of active templates for one channel (whatsapp/sms/email),
 * carrying each template's declared `variables` so the UI can offer exactly
 * the tokens the template accepts. No send path is enabled here: WhatsApp
 * sends additionally need an approved template with a provider id, enforced
 * at tick time by the template gate and at compose time by the picker.
 */

const TEMPLATE_FIELDS = [
  'id',
  'key',
  'channel',
  'category',
  'approval_status',
  'provider_template_id',
  'body',
  'variables',
  'active',
]

const CHANNELS = ['whatsapp', 'sms', 'email'] as const

export default defineEventHandler(async (event) => {
  const scope = await getPortalScope(event)
  requireCan(scope, 'message_templates', 'read')

  const query = getQuery(event)
  const channel = typeof query.channel === 'string' ? query.channel : ''
  if (!(CHANNELS as readonly string[]).includes(channel)) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Channel must be one of whatsapp, sms, email',
      data: { code: 'validation_error' },
    })
  }

  const result = await listItems<Record<string, unknown>>(
    event,
    scope,
    'message_templates',
    {
      filter: { active: { _eq: true }, channel: { _eq: channel } },
      fields: TEMPLATE_FIELDS,
      sort: 'key',
      limit: -1,
    },
  ).catch(() => null)
  return result ?? { data: [] as Array<Record<string, unknown>> }
})
