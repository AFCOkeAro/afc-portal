import type { H3Event } from 'h3'
import { readSession, writeSession } from './session'
import type { PortalSessionData } from './session'

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

  return requestWithRefresh<T>(event, url, path, options, token, false)
}

async function performDirectusRequest<T>(
  url: string,
  options: DirectusFetchOptions,
  token: string,
): Promise<T> {
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
}

/**
 * Request wrapper with one-shot refresh-and-retry (permanent fix for the
 * recurring `GET /api/finance/records → 500 DirectusAuthError: Token expired`).
 *
 * Directus access tokens expire (default 15m) while the portal session cookie
 * lives 8h. Before this wrapper, the first request after expiry threw an
 * unhandled `DirectusAuthError` → Nitro 500 on every data route until the user
 * manually re-logged in. Now:
 *
 * - a 401/403 on a call carrying the session's current user token triggers one
 *   `POST /auth/refresh` with the stored refresh token, reseals the session
 *   with the new pair, and retries the original request once;
 * - a user-token failure that cannot be refreshed (rotated/revoked refresh
 *   token) becomes a clean 401 `reauthenticate` so the UI routes to sign-in;
 * - the server-token path (no session, or callers using the shared fallback
 *   token) is untouched: a rejection there is a deployment fault and still
 *   surfaces as `DirectusAuthError` (500), exactly as before — including the
 *   `/auth/login` flow, which runs with no session.
 */
async function requestWithRefresh<T>(
  event: H3Event,
  url: string,
  path: string,
  options: DirectusFetchOptions,
  token: string,
  retried: boolean,
): Promise<T> {
  try {
    return await performDirectusRequest<T>(url, options, token)
  } catch (cause) {
    const mapped = mapDirectusError(cause, path)
    if (!(mapped instanceof DirectusAuthError)) {
      throw mapped
    }
    const session = await readSession(event).catch(() => null)
    const isUserToken =
      !!session?.accessToken && session.accessToken === token
    if (!isUserToken) {
      throw mapped
    }
    if (!retried) {
      const retryToken = await tryRefreshSessionToken(event, session)
      if (retryToken) {
        return requestWithRefresh<T>(event, url, path, options, retryToken, true)
      }
    }
    throw createError({
      statusCode: 401,
      statusMessage: 'Sign in to continue',
      data: { code: 'reauthenticate' },
    })
  }
}

interface DirectusRefreshResponse {
  data: {
    access_token: string
    refresh_token: string | null
    expires: number
  }
}

/**
 * Exchange the session's refresh token for a new pair and reseal the session.
 * Returns the new access token, or null when there is nothing usable to
 * refresh with (no refresh token, already rotated, or refresh rejected).
 * Never throws: a failed refresh is a normal "re-authenticate" outcome, and it
 * must not mask the original request error with a second 500.
 */
async function tryRefreshSessionToken(
  event: H3Event,
  session: PortalSessionData,
): Promise<string | null> {
  if (!session.refreshToken) {
    return null
  }
  try {
    const refreshed = await $fetch<DirectusRefreshResponse>(
      `${directusBaseUrl(event)}/auth/refresh`,
      {
        method: 'POST',
        body: { refresh_token: session.refreshToken, mode: 'json' },
      },
    )
    const accessToken = refreshed?.data?.access_token
    if (!accessToken) {
      return null
    }
    await writeSession(event, {
      accessToken,
      refreshToken: refreshed.data.refresh_token ?? session.refreshToken,
      session: session.session,
    })
    return accessToken
  } catch {
    return null
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
  return createError({
    statusCode: status >= 400 && status < 600 ? status : 502,
    statusMessage: detail
      ? `Directus request to ${path} failed: ${detail}`
      : `Directus request to ${path} failed`,
    data: { code: first?.extensions?.code ?? 'directus_error' },
  })
}
