import { isKioskBadgePublicLeaf } from '~/utils/public-routes'

/**
 * Staff guard.
 *
 * Refuses a session that has no staff role. `staff_role: 'none'` is a real state
 * — a Directus user created for the public registration flow has no staff role
 * — and such a user has a valid session and no capabilities at all. Without this
 * guard they would land on the dashboard with an empty navigation and no
 * explanation of why.
 *
 * Named middleware: applied per page with
 * `definePageMeta({ middleware: 'staff' })`.
 *
 * Kiosk/badge exemption (AFC-1008): the parent `pages/events/[id].vue` declares
 * this guard, and Nuxt still runs parent-route middleware for child paths —
 * so `/events/<id>/kiosk` and `/events/<id>/badge` (whose own page meta only
 * sets `layout: 'public'`) would 302 to bare `/login` even after the global
 * guard exempts them. Return early on the two shared public leaves; bare
 * `/events/<id>`, `/events`, and any nested suffix stay guarded.
 */
export default defineNuxtRouteMiddleware(async (to) => {
  if (isKioskBadgePublicLeaf(to.path)) return

  const auth = useAuth()
  const session = await auth.ensureSession()
  if (!session) return navigateTo('/login', { replace: true })

  if (session.user.staffRole === 'none') {
    return abortNavigation(
      createError({
        statusCode: 403,
        statusMessage:
          'This account has no staff role. Ask an area administrator for one.',
      }),
    )
  }
})
