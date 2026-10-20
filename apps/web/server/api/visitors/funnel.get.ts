import { getPortalScope } from '../../utils/portal'
import { buildFunnelForScope } from '../../utils/visitor-journey'

export default defineEventHandler(async (event) => {
  const scope = await getPortalScope(event)
  return { data: await buildFunnelForScope(event, scope) }
})
