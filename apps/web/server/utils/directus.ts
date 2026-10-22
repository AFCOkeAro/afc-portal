import type { H3Event } from 'h3'

/**
 * The only module that reads the Directus base URL.
 *
 * Every server route reaches the API through here, so changing the base URL or
 * the governance layer is one edit in one file (data-model §13 rule 5). Browser
 * code has no equivalent, because the browser is never given a credential to do
 * this with (repo-plan §6).
 */

export interface DirectusFetchOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE'
  query?: Record<string, unknown>
  body?: unknown
  /** The signed-in user's own token. Falls back to the scoped server token. */
  accessToken?: string | null
  /** Accept an upstream error body instead of raising. */
  tolerateError?: boolean
}

/**
 * A Directus token was rejected. Thrown by the routes that authenticate, so the
 * caller can clear the session and send the user to the sign-in page instead of
 * surfacing a 500.
 */
export class DirectusAuthError extends Error {
  constructor(message = 'The session token was rejected') {
    super(message)
    this.name = 'DirectusAuthError'
  }
}

export function directusBaseUrl(event: H3Event): string {
  const config = useRuntimeConfig(event)
  const url = String(config.directusUrl ?? '').replace(/\/+$/, '')
  if (!url) {
    // A missing base URL is a deployment fault, not a client error. Failing here
    // with a named message beats a 500 from a fetch to `undefined/items/people`.
    throw createError({
      statusCode: 503,
      statusMessage: 'DIRECTUS_URL is not configured for this deployment',
    })
  }
  return url
}

/**
 * True when the server token is absent. `/api/health` reports this rather than
 * failing, so a monitoring probe can tell "not deployed yet" apart from "Directus
 * is down".
 */
export function directusIsConfigured(event: H3Event): boolean {
  const config = useRuntimeConfig(event)
  return Boolean(String(config.directusUrl ?? '').trim())
}

export async function directusFetch<T>(
  event: H3Event,
  path: string,
  options: DirectusFetchOptions = {},
): Promise<T> {
  const config = useRuntimeConfig(event)
  const token = options.accessToken ?? String(config.directusServerToken ?? '')
  const url = `${directusBaseUrl(event)}${path}`

  try {
    // `$fetch` is typed against the typed routes, which know nothing about
    // Directus. The cast is confined to this one call; every caller above sees
    // the `T` the function was asked for.
    return (await $fetch(url, {
      method: options.method ?? 'GET',
      query: options.query,
      body: options.body as Record<string, unknown> | undefined,
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      ignoreResponseError: options.tolerateError === true,
    })) as T
  } catch (cause) {
    throw mapDirectusError(cause, path)
  }
}

function mapDirectusError(cause: unknown, path: string): Error {
  const error = cause as {
    statusCode?: number
    status?: number
    statusMessage?: string
    data?: { errors?: Array<{ message?: string; extensions?: { code?: string } }> }
  }
  const status = error?.statusCode ?? error?.status ?? 500
  const first = error?.data?.errors?.[0]

  if (status === 401 || status === 403) {
    return new DirectusAuthError(
      first?.message ?? `Directus rejected the request to ${path}`,
    )
  }

  const detail = first?.message ?? error?.statusMessage
  // AFC-654: a 5xx from Directus can embed raw SQL (e.g. `invalid input
  // syntax for type uuid` with the failed statement). Never copy upstream
  // detail into a 5xx statusMessage; the named store error downstream names
  // the migration instead. Client-error (4xx) detail passes through so
  // scope 404s keep their explanation.
  if (status >= 500 || status < 400) {
    return createError({
      statusCode: status >= 500 && status < 600 ? status : 502,
      statusMessage: `Directus request to ${path} failed`,
      data: { code: first?.extensions?.code ?? 'directus_error' },
    })
  }
  return createError({
    statusCode: status,
    statusMessage: detail
      ? `Directus request to ${path} failed: ${detail}`
      : `Directus request to ${path} failed`,
    data: { code: first?.extensions?.code ?? 'directus_error' },
  })
}
