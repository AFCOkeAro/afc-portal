import { feedbackFormSchema } from '@afc/shared'
import { directusFetch } from '../../../../utils/directus'

/**
 * POST /api/public/events/:id/feedback — fan feedback for a public event
 * (AFC-828 phase 2).
 *
 * SECURITY LENS (the /api/register contract, repeated because it is
 * load-bearing here too):
 *
 * 1. NO SESSION and no server token. The write rides the public-scoped
 *    token (`NUXT_DIRECTUS_PUBLIC_TOKEN`), whose Directus policy is the
 *    public role's. A field allowlist is the only thing standing between
 *    the internet and the collection, so the body is projected onto exactly
 *    the submission keys before the write.
 * 2. SERVER-SIDE VISIBILITY FILTER. The event must be visibility=public
 *    (and published) or the route 404s exactly like a missing event —
 *    internal programmes never accept public words.
 * 3. VALIDATE, THEN PROJECT. The shared schema validates; only name,
 *    message, rating and contact reach Directus.
 *
 * NOT IMPLEMENTED, DELIBERATELY (same note as /api/register): shared-store
 * rate limiting needs a CTO topology decision; a per-instance limiter
 * would be worse than none behind more than one worker.
 */
const SUBMISSION_KEYS = [
  'event',
  'branch',
  'zone',
  'name',
  'message',
  'rating',
  'contact',
] as const

export default defineEventHandler(async (event) => {
  const config = useRuntimeConfig(event)
  const publicToken = String(config.directusPublicToken ?? '')
  if (!publicToken) {
    throw createError({
      statusCode: 503,
      statusMessage:
        'NUXT_DIRECTUS_PUBLIC_TOKEN is not configured. The feedback form is closed.',
      data: { code: 'feedback_unavailable' },
    })
  }
  const id = getRouterParam(event, 'id')
  if (!id)
    throw createError({ statusCode: 400, statusMessage: 'An event id is required' })

  const parsed = feedbackFormSchema.safeParse(await readBody(event))
  if (!parsed.success) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Check the highlighted fields and submit again',
      data: { code: 'invalid_feedback' },
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
        filter: { id: { _eq: id }, visibility: { _eq: 'public' } },
        fields: 'id,status,branch',
        limit: 1,
      },
    },
  ).then((response) => response.data[0] ?? null)
  if (!eventRow || eventRow.status !== 'published') {
    throw createError({
      statusCode: 404,
      statusMessage: 'That event is not open for feedback',
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
      .then((response) => response.data[0] ?? null)
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
    rating: form.rating ?? null,
    contact: form.contact?.trim() || null,
  }
  for (const key of Object.keys(body)) {
    if (!(SUBMISSION_KEYS as readonly string[]).includes(key)) delete body[key]
  }
  const created = await directusFetch<{ data: { id: string } }>(
    event,
    '/items/event_feedback',
    {
      method: 'POST',
      accessToken: publicToken,
      body,
    },
  )
  return { data: { id: String(created.data.id) } }
})
