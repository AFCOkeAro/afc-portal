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
  return Boolean(String(useRuntimeConfig(event).directusUrl ?? '').trim())
}

export async function directusFetch<T>(
  event: H3Event,
  path: string,
  options: DirectusFetchOptions = {},
): Promise<T> {
  const config = useRuntimeConfig(event)
  const token = options.accessToken ?? String(config.directusServerToken ?? '')
  const url = `${directusBaseUrl(event)}${path}`

  // Whether this call carries the session's current user token, resolved once
  // up front and passed through the retry unchanged. Re-reading the sealed
  // cookie after a refresh would compare the OLD request cookie against the NEW
  // retried token and misclassify the retry as a server-token call.
  const session = await readSession(event).catch(() => null)
  const userToken =
    session?.accessToken && session.accessToken === token ? session.accessToken : null

  return attemptRequest<T>(event, url, path, options, token, session, userToken, false)
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
 * - a 401 on a call carrying the session's current user token triggers one
 *   `POST /auth/refresh` with the stored refresh token, reseals the session
 *   with the new pair, and retries the original request once;
 * - a user-token failure that cannot be refreshed (rotated/revoked refresh
 *   token) becomes a clean 401 `reauthenticate` so the UI routes to sign-in;
 * - a 403 (missing permission OR missing collection/schema) is NEVER a token
 *   problem: no refresh is attempted and it surfaces as a clean, named 403
 *   instead of an unactionable 500;
 * - the server-token path (no session, or callers using the shared fallback
 *   token) is untouched: a rejection there is a deployment fault and still
 *   surfaces as `DirectusAuthError` (500), exactly as before — including the
 *   `/auth/login` flow, which runs with no session.
 */
async function attemptRequest<T>(
  event: H3Event,
  url: string,
  path: string,
  options: DirectusFetchOptions,
  token: string,
  session: PortalSessionData | null,
  userToken: string | null,
  retried: boolean,
): Promise<T> {
  try {
    return await performDirectusRequest<T>(url, options, token)
  } catch (cause) {
    const mapped = mapDirectusError(cause, path)
    if (!(mapped instanceof DirectusAuthError)) {
      throw mapped
    }
    if (!userToken || !session) {
      throw mapped
    }
    if (readDirectusStatus(cause) !== 401) {
      throw createError({
        statusCode: 403,
        statusMessage: `Directus denied access to ${path} — check Directus permissions or schema`,
        data: { code: 'directus_forbidden', path },
      })
    }
    if (!retried) {
      const retryToken = await tryRefreshSessionToken(event, session)
      if (retryToken) {
        return attemptRequest<T>(
          event,
          url,
          path,
          options,
          retryToken,
          session,
          userToken,
          true,
        )
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
 * In-flight refreshes, keyed by the refresh token being exchanged.
 *
 * A dashboard load fires many API calls in parallel; when the access token has
 * just expired they all 401 at once. Without dedup they would each POST
 * /auth/refresh with the same token — Directus rotates refresh tokens on use,
 * so the first wins and the rest get 401, surfacing a bogus "session has
 * ended" even though the session is fine. Sharing one promise per refresh
 * token means a single exchange and every waiter retries with the new access
 * token. Entries are removed when settled, so this never grows.
 */
const inflightRefreshes = new Map<string, Promise<string | null>>()

async function tryRefreshSessionToken(
  event: H3Event,
  session: PortalSessionData,
): Promise<string | null> {
  if (!session.refreshToken) {
    return null
  }
  const key = session.refreshToken
  const existing = inflightRefreshes.get(key)
  if (existing) {
    return existing
  }
  const pending = doRefreshSessionToken(event, session).finally(() => {
    if (inflightRefreshes.get(key) === pending) {
      inflightRefreshes.delete(key)
    }
  })
  inflightRefreshes.set(key, pending)
  return pending
}

/**
 * Exchange the session's refresh token for a new pair and reseal the session.
 * Returns the new access token, or null when there is nothing usable to
 * refresh with (no refresh token, already rotated, or refresh rejected).
 * Never throws: a failed refresh is a normal "re-authenticate" outcome, and it
 * must not mask the original request error with a second 500.
 */
async function doRefreshSessionToken(
  event: H3Event,
  session: PortalSessionData,
): Promise<string | null> {
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

function readDirectusStatus(cause: unknown): number {
  const error = cause as {
    statusCode?: number
    status?: number
  }
  return error?.statusCode ?? error?.status ?? 500
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
