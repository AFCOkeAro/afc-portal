import type { AuthSession, LoginCredentials, PortalUser } from '@afc/shared'
import type { AuthState } from '~/server/api/auth/me.get'
import { ApiRequestError } from './useApi'

/**
 * `useAuth` — session state for the browser.
 *
 * The session itself lives in an httpOnly cookie set by `/api/auth/login` and is
 * never held in a `useState` value or a `localStorage` key: this repository
 * holds children's records, and a token in `localStorage` is readable by any
 * script that lands on the origin. What is mirrored into client state is the
 * *reduced* user projection, which is not a credential.
 *
 * A 401 from any call clears the mirrored session so the guard reacts without a
 * page reload.
 */
export function useAuth() {
  const api = useApi()
  const session = useState<AuthSession | null>('afc:session', () => null)
  const loading = useState<boolean>('afc:session:loading', () => false)

  const user = computed<PortalUser | null>(() => session.value?.user ?? null)
  const isAuthenticated = computed(() => session.value !== null)

  /**
   * Fetch the session once per request. Safe to call from middleware, a layout
   * and a page: the second caller gets the cached value.
   */
  async function ensureSession(): Promise<AuthSession | null> {
    if (session.value) return session.value
    loading.value = true
    try {
      const state = await api.get<AuthState>('/api/auth/me')
      session.value = state.session
      return state.session
    } catch (cause) {
      // A transport failure here is a real fault and is re-thrown, so a broken
      // auth service is not presented to users as a logout.
      if (cause instanceof ApiRequestError && cause.status === 401) {
        session.value = null
        return null
      }
      throw cause
    } finally {
      loading.value = false
    }
  }

  async function login(credentials: LoginCredentials): Promise<AuthSession> {
    const next = await api.post<AuthSession>('/api/auth/login', credentials)
    session.value = next
    return next
  }

  async function logout(): Promise<void> {
    try {
      await api.post('/api/auth/logout')
    } finally {
      // Clear the local projection even if the server call failed. Leaving a
      // logged-in shell on screen after a failed logout is worse than the
      // opposite.
      session.value = null
      await navigateTo('/login')
    }
  }

  /** Force the next `ensureSession` to re-read the cookie. Used after a 401. */
  function invalidate(): void {
    session.value = null
  }

  return {
    session: readonly(session),
    user,
    isAuthenticated,
    loading: readonly(loading),
    ensureSession,
    login,
    logout,
    invalidate,
  }
}
