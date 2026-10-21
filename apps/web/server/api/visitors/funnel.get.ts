import { getPortalScope, throwStoreUnavailable } from '../../utils/portal'
import { buildFunnelForScope } from '../../utils/visitor-journey'

export default defineEventHandler(async (event) => {
  const scope = await getPortalScope(event)
  // AFC-583: the funnel folds 0025 register rows — map an unreadable store
  // to the named error, never a bare 500. Deliberate 4xx pass through untouched.
  try {
    return { data: await buildFunnelForScope(event, scope) }
  } catch (error) {
    if ((error as { statusCode?: number })?.statusCode) throw error
    throwStoreUnavailable(error, 'visitor_store', '0025')
  }
})
