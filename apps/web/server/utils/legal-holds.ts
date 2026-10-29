import { Pool } from 'pg'
import type { H3Event } from 'h3'

/**
 * Legal-hold release database path (AFC-243).
 *
 * The portal server reaches `retention.release_hold_as` as the dedicated
 * `legal_hold_releaser` identity -- never as `directus_app`. The credential
 * lives in server runtime config (`legalHoldDatabaseUrl`), never in the repo
 * and never in the browser. An application-side compromise (the pooled
 * `directus_app` credential) cannot call the release function at all: no
 * grant, and a session check inside that refuses it with the same 42501.
 *
 * The releaser this module passes is ALWAYS the authenticated portal user
 * the route resolved from the Directus session. The request body is ignored
 * by the route on purpose: a caller-supplied releaser is the defect AFC-208
 * revoked, and this path must never reintroduce it.
 */

let pool: Pool | null = null

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function releasePool(event: H3Event): Pool {
  if (pool) return pool
  const config = useRuntimeConfig(event)
  const connectionString = String(config.legalHoldDatabaseUrl ?? '')
  if (!connectionString) {
    throw createError({
      statusCode: 503,
      statusMessage: 'Legal-hold release is not configured for this deployment',
      data: { code: 'legal_hold_not_configured' },
    })
  }
  // max 1: the database role carries CONNECTION LIMIT 1 (bootstrap), so the
  // pool serialises releases client-side instead of failing loudly. A
  // release is a rare DPO action, not a pooled workload.
  pool = new Pool({ connectionString, max: 1 })
  return pool
}

/**
 * Release a legal hold, stamping `released_by` with the authenticated user.
 * Throws 404 when there is no active hold (unknown id or already released),
 * 503 when the release path is not configured or unreachable.
 */
export async function releaseLegalHoldAs(
  event: H3Event,
  holdId: string,
  releaserId: string,
): Promise<void> {
  if (!UUID_RE.test(holdId) || !UUID_RE.test(releaserId)) {
    throw createError({
      statusCode: 400,
      statusMessage: 'That release request is not valid',
      data: { code: 'validation_error' },
    })
  }
  let client
  try {
    client = await releasePool(event).connect()
  } catch {
    throw createError({
      statusCode: 503,
      statusMessage: 'Legal-hold release is unavailable right now',
      data: { code: 'legal_hold_unavailable' },
    })
  }
  try {
    // Parameterised, never interpolated: the two values are uuids validated
    // above, and the function stamps exactly the releaser passed here --
    // which the route set to the session user, not to caller input.
    await client.query('SELECT retention.release_hold_as($1::uuid, $2::uuid)', [
      holdId,
      releaserId,
    ])
  } catch (cause) {
    const code = (cause as { code?: string } | null)?.code
    // 22023 is what the function raises when there is no active hold for the
    // id (unknown, or already released): nothing to release, so 404 rather
    // than a 500. 42501 here means the server connected as the wrong role --
    // a deployment fault, never a user error -- so it stays a 500.
    if (code === 'invalid_parameter_value') {
      throw createError({
        statusCode: 404,
        statusMessage: 'There is no active legal hold to release',
        data: { code: 'hold_not_active' },
      })
    }
    throw cause
  } finally {
    client.release()
  }
}
