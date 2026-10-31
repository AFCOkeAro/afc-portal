/**
 * Staging zero-downtime deploy pins (follow-up to the kiosk staging work).
 *
 * Sessions must survive staging redeploys: the cookie is stateless and the
 * seal secret is stable, so the only session-killer is cutting in-flight
 * requests — above all the Directus refresh reseal, whose loss desyncs the
 * rotated refresh token and permanently kills the session at the next
 * access-token expiry. These asserts pin the three cooperating pieces:
 * drain (compose), retry-while-down (Caddy), graceful close (app).
 *
 * Run: node --test tests/web/staging-zero-downtime.contract.mjs
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const read = (rel) => readFileSync(path.join(root, rel), 'utf8')

describe('staging deploys do not drop in-flight requests', () => {
  it('compose gives web time to drain on SIGTERM', () => {
    const compose = read('services/staging/compose.yml')
    assert.match(compose, /stop_grace_period:\s*60s/)
  })

  it('caddy retries while the replacement boots (no user-visible gap)', () => {
    const caddy = read('services/staging/Caddyfile')
    assert.match(caddy, /lb_try_duration/)
    assert.match(caddy, /lb_try_interval/)
  })

  it('app drains on SIGTERM instead of dying mid-request', () => {
    const plugin = read('apps/web/server/plugins/graceful-shutdown.ts')
    assert.match(plugin, /SIGTERM/)
    assert.match(plugin, /callHook\('close'\)/)
  })
})
