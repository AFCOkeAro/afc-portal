import { directusIsConfigured } from '../utils/directus'

/**
 * GET /api/health
 *
 * Liveness for the `portal` probe in the monitoring plan. It deliberately does
 * NOT call Directus: a probe that fails when the dependency is slow pages the
 * on-call for a portal that is still serving reads from cache, and a probe that
 * reports "not deployed yet" as "down" is worse than one that reports the
 * configuration state honestly.
 *
 * It answers 200 whenever the process is up, and reports whether Directus is
 * configured so a deployment can be checked from outside.
 */
export default defineEventHandler((event) => {
  const config = useRuntimeConfig(event)
  return {
    status: 'ok',
    app: config.public.appName,
    directusConfigured: directusIsConfigured(event),
    registrationOpen: Boolean(String(config.directusPublicToken ?? '').trim()),
    at: new Date().toISOString(),
  }
})
