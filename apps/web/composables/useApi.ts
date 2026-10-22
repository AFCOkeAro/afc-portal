import type { ApiError } from '@afc/shared'

/**
 * `useApi` — the one place the portal talks to its own server.
 *
 * WHY THIS EXISTS (data-model §13 rule 5): "keep a thin `useApi` that
 * centralises base URL, auth, and error handling — swapping from Directus REST
 * to another gateway is configuration there, not a UI rewrite."
 *
 * The split is deliberate and worth knowing before you change it:
 *
 *   - Browser → `useApi` → a named server route under `/api/*`. The browser
 *     never receives the Directus credential (repo-plan §6) and cannot ask the
 *     server for an arbitrary collection: the server routes name the operations
 *     they expose. There is no generic `/api/directus/<collection>` proxy, and
 *     adding one would hand the browser whatever its session token can reach.
 *
 *   - Server route → `server/utils/directus.ts` → Directus. That file is the
 *     single reader of `runtimeConfig.directusUrl`, so a change of base URL or
 *     of governance layer is one edit in one file.
 */

/** A failed API call, normalised so callers branch on `code`, not on prose. */
export class ApiRequestError extends Error {
  readonly code: string
  readonly status: number
  readonly fields: Record<string, string>

  constructor(status: number, body: Partial<ApiError['error']> | null) {
    super(body?.message ?? `Request failed with status ${status}`)
    this.name = 'ApiRequestError'
    this.status = status
    this.code = body?.code ?? 'unknown_error'
    this.fields = body?.fields ?? {}
  }
}

export interface ApiRequestOptions {
  query?: Record<string, unknown>
  body?: unknown
  /** Send to the Directus-facing server routes instead of the portal's own. */
  headers?: Record<string, string>
  /** Do not raise on a non-2xx response; the caller handles the body. */
  tolerateError?: boolean
}

export function useApi() {
  const config = useRuntimeConfig()

  // `useRequestFetch` forwards the incoming request's cookies during SSR, so a
  // server-rendered page is authorised exactly as the browser would be. Plain
  // `$fetch` on the server would send no cookie and every SSR request would
  // look like a logged-out visitor.
  const request = useRequestFetch()

  async function call<T>(
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
    path: string,
    options: ApiRequestOptions = {},
    retried = false,
  ): Promise<T> {
    try {
      // The cast is confined to this call. `useRequestFetch` is typed against the
      // typed routes; `/api/*` routes do declare their return types, but the
      // generic here is chosen by the caller and cannot be reconciled with that
      // inference.
      return (await request(path, {
        method,
        query: options.query,
        body: options.body as Record<string, unknown> | undefined,
        headers: options.headers,
        // Server routes set their own status codes, including the 4xx that carry
        // a field-level message the form needs to show next to an input.
        ignoreResponseError: options.tolerateError === true,
      })) as T
    } catch (cause) {
      if (!retried && readStatus(cause) === 401) {
        // A 401 can be transient: the portal session cookie is sealed and
        // stateless, so a request dispatched with a just-rotated cookie fails
        // even though a parallel request already refreshed the session
        // server-side and resealed the cookie (see
        // server/utils/directus.ts requestWithRefresh). Retry once — the
        // browser sends the latest cookie, which carries the fresh tokens —
        // and only treat a second 401 as a real sign-out.
        // Safe for every method: server routes authenticate (requireSession /
        // getPortalScope) before any side effect, so a 401 means nothing
        // executed and the retry cannot double-apply.
        await new Promise((resolve) => setTimeout(resolve, 300))
        return call<T>(method, path, options, true)
      }
      throw toApiRequestError(cause, method, path)
    }
  }

  return {
    /**
     * Browser-visible Directus URL. Read-only display use — file links, the
     * public event URL. Data access goes through the server routes.
     */
    directusUrl: config.public.directusUrl as string,
    appName: config.public.appName as string,
    get: <T>(path: string, options?: ApiRequestOptions) => call<T>('GET', path, options),
    post: <T>(path: string, body?: unknown, options?: ApiRequestOptions) =>
      call<T>('POST', path, { ...options, body }),
    put: <T>(path: string, body?: unknown, options?: ApiRequestOptions) =>
      call<T>('PUT', path, { ...options, body }),
    patch: <T>(path: string, body?: unknown, options?: ApiRequestOptions) =>
      call<T>('PATCH', path, { ...options, body }),
    remove: <T>(path: string, options?: ApiRequestOptions) =>
      call<T>('DELETE', path, options),
  }
}

function readStatus(cause: unknown): number {
  return (
    (cause as { response?: { status?: number } })?.response?.status ?? 0
  )
}

function toApiRequestError(cause: unknown, method: string, path: string): Error {
  if (cause instanceof ApiRequestError) return cause

  const response = (cause as { response?: { status?: number; _data?: unknown } })
    ?.response
  const status = response?.status ?? 0
  const data = response?._data as Partial<ApiError['error']> | undefined

  if (status === 401) {
    return new ApiRequestError(401, {
      code: 'unauthenticated',
      message: 'Your session has ended. Sign in again.',
    })
  }
  if (status === 403) {
    return new ApiRequestError(403, {
      code: 'forbidden',
      message: 'You do not have access to that.',
    })
  }
  if (data && typeof data === 'object' && 'code' in data) {
    return new ApiRequestError(status, data)
  }
  // A network failure or a 5xx from an unbuilt route. Keep the method and path
  // in the message because "fetch failed" alone is not diagnosable.
  return new ApiRequestError(status, {
    code: status === 0 ? 'network_error' : 'server_error',
    message: `${method} ${path} failed (${status || 'no response'})`,
  })
}
