import { testimonyFormSchema } from '@afc/shared'
import { directusFetch } from '../../../../utils/directus'

/**
 * POST /api/public/events/:id/testimonies — share a testimony (AFC-828
 * phase 4; feedback precedent).
 *
 * NO SESSION, public token only, visibility + published re-checked, body
 * projected onto the submission keys. No rate limiting yet (same
 * deliberate non-goal as /api/register: needs a shared store).
 */
const SUBMISSION_KEYS = ['event', 'branch', 'zone', 'name', 'message', 'contact'] as const

export default defineEventHandler(async (event) => {
  const config = useRuntimeConfig(event)
  const publicToken = String(config.directusPublicToken ?? '')
  if (!publicToken) {
    throw createError({
      statusCode: 503,
      statusMessage:
        'NUXT_DIRECTUS_PUBLIC_TOKEN is not configured. The testimony form is closed.',
      data: { code: 'testimony_unavailable' },
    })
  }
  const id = getRouterParam(event, 'id')
  if (!id)
    throw createError({ statusCode: 400, statusMessage: 'An event id is required' })

  const parsed = testimonyFormSchema.safeParse(await readBody(event))
  if (!parsed.success) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Check the highlighted fields and submit again',
      data: { code: 'invalid_testimony' },
    })
  }
  const form = parsed.data

  const eventRow = await directusFetch<{ data: Record<string, unknown>[] }>(
    event,
    '/items/events',
    {
      method: 'GET',
      accessToken: publicToken,
      query: {
        filter: {
          id: { _eq: id },
          visibility: { _eq: 'public' },
          status: { _eq: 'published' },
        },
        fields: 'id,branch',
        limit: 1,
      },
    },
  ).then((response: { data: Array<Record<string, unknown>> }) => response.data[0] ?? null)
  if (!eventRow) {
    throw createError({
      statusCode: 404,
      statusMessage: 'That event is not open for testimonies',
      data: { code: 'event_not_open' },
    })
  }

  let zone: string | null = null
  const branch =
    typeof eventRow.branch === 'string' && eventRow.branch !== '' ? eventRow.branch : null
  if (branch) {
    const parent = await directusFetch<{ data: Array<{ zone: unknown }> }>(
      event,
      '/items/branches',
      {
        method: 'GET',
        accessToken: publicToken,
        query: { filter: { id: { _eq: branch } }, fields: 'zone', limit: 1 },
      },
    )
      .then((response: { data: Array<{ zone: unknown }> }) => response.data[0] ?? null)
      .catch(() => null)
    const raw = parent?.zone
    zone = typeof raw === 'string' && raw.length > 0 ? raw : null
  }

  const body: Record<string, unknown> = {
    event: id,
    branch,
    zone,
    name: form.name?.trim() || null,
    message: form.message.trim(),
    contact: form.contact?.trim() || null,
  }
  for (const key of Object.keys(body)) {
    if (!(SUBMISSION_KEYS as readonly string[]).includes(key)) delete body[key]
  }
  const created = await directusFetch<{ data: { id: string } }>(
    event,
    '/items/event_testimonies',
    {
      method: 'POST',
      accessToken: publicToken,
      body,
    },
  )
  return { data: { id: String(created.data.id) } }
})
