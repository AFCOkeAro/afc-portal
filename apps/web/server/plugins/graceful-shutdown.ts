/**
 * Graceful shutdown for zero-downtime staging deploys.
 *
 * `docker compose up -d --force-recreate` sends SIGTERM and (after the
 * compose stop_grace_period) SIGKILL. Node exits immediately on an
 * unhandled SIGTERM, dropping in-flight requests — including the Directus
 * refresh reseal, whose loss desyncs the rotated refresh token and kills
 * the session on the next expiry. Draining first means deploys are
 * invisible: Caddy retries (lb_try_duration) while the new container
 * boots, and no established request is ever cut.
 */
export default defineNitroPlugin((nitroApp) => {
  let closing = false
  const shutdown = () => {
    if (closing) return
    closing = true
    void nitroApp.hooks.callHook('close')
  }
  process.once('SIGTERM', shutdown)
  process.once('SIGINT', shutdown)
})
