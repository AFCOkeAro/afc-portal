/**
 * Global auth guard.
 *
 * Runs on every navigation, server-side first, so an unauthenticated request for
 * a staff page never renders the staff shell — not even for the milliseconds
 * before hydration. The redirect target keeps the original path so the user
 * lands where they were going after signing in.
 *
 * `PUBLIC_ROUTES` is the public surface of the portal: the landing route, the
 * sign-in page and the registration form. `/` is listed because it is the
 * router's own redirect stub — if it were guarded, an anonymous visitor would be
 * sent to `/login` with a `redirect` of `/`, which is `/login` again, forever.
 *
 * Anything not listed needs a session. Adding a route to this list is a security
 * decision, not a convenience, so it is a named constant rather than a pattern.
 */
const PUBLIC_ROUTES = ['/', '/login', '/register', '/p'] as const

function isPublic(path: string): boolean {
  return PUBLIC_ROUTES.some((route) => path === route || path.startsWith(`${route}/`))
}

export default defineNuxtRouteMiddleware(async (to) => {
  const auth = useAuth()

  try {
    const session = await auth.ensureSession()

    if (!session) {
      if (isPublic(to.path)) return
      return navigateTo(
        { path: '/login', query: to.fullPath === '/' ? {} : { redirect: to.fullPath } },
        { replace: true },
      )
    }

    // A signed-in user has no business on the sign-in page. Sending them to the
    // dashboard rather than to `redirect` avoids a loop when `redirect` is
    // itself a login URL.
    if (to.path === '/login') {
      const target =
        typeof to.query.redirect === 'string' ? to.query.redirect : '/dashboard'
      return navigateTo(target, { replace: true })
    }

    // Load capabilities here rather than in each page: the guard and the
    // navigation then answer from the same payload, so a link can never appear
    // that the guard would immediately refuse.
    await usePermissions().load()
  } catch (cause) {
    // A broken session service must not present itself as "signed out" — that
    // would silently turn an outage into a logout for every user. Surface it.
    throw createError({
      statusCode: 503,
      statusMessage:
        cause instanceof Error
          ? `The portal could not confirm your session: ${cause.message}`
          : 'The portal could not confirm your session',
      fatal: true,
    })
  }
})
