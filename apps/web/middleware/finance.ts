import { COLLECTIONS } from '@afc/shared'

/**
 * Finance guard (AFC-475, data-model-expansion §11).
 *
 * Finance reads split two ways: capture amounts (`branch_financial_records`,
 * branch admin own / area+) and computed returns (`weca_returns`, area+ for
 * amounts, branch admin own rows redacted). Either read grant opens the
 * section; volunteers and department leaders hold neither, so a typed URL
 * becomes a 403 rather than an empty page. As with welfare, the guard reads
 * capabilities, not roles (data-model §13 rule 7).
 */
export default defineNuxtRouteMiddleware(async () => {
  const auth = useAuth()
  const session = await auth.ensureSession()
  if (!session) return navigateTo('/login', { replace: true })

  const permissions = usePermissions()
  const payload = await permissions.load()

  const mayRead =
    permissions.can(COLLECTIONS.branchFinancialRecords, 'read') ||
    permissions.can(COLLECTIONS.wecaReturns, 'read')
  if (!mayRead) {
    return abortNavigation(
      createError({
        statusCode: 403,
        statusMessage: 'You do not have access to finance records.',
      }),
    )
  }

  if (!payload.scoped) {
    return abortNavigation(
      createError({
        statusCode: 403,
        statusMessage:
          'This account is not assigned to a branch, so no records are visible to it.',
      }),
    )
  }
})
