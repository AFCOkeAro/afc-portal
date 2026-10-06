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
 */
export default defineNuxtRouteMiddleware(async () => {
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
