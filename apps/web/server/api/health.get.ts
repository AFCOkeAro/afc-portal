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
    // Staging SHA-proof (AFC-718). Prefers runtimeConfig.public.buildSha when
    // the Nuxt config declares it (backed by NUXT_PUBLIC_BUILD_SHA); falls
    // back to the env var directly so the probe works even when the config
    // key is absent. 'unknown' in dev and in images built without a SHA.
    // A commit SHA is public repository metadata, never a secret.
    sha: buildShaOf(config),
    at: new Date().toISOString(),
  }
})

function buildShaOf(config: ReturnType<typeof useRuntimeConfig>): string {
  const fromConfig = (config.public as { buildSha?: unknown }).buildSha
  const raw = fromConfig ?? process.env.NUXT_PUBLIC_BUILD_SHA ?? ''
  const sha = String(raw).trim()
  return sha === '' ? 'unknown' : sha
}
