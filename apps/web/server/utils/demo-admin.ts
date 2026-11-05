import { Pool } from 'pg'
import { readFileSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { H3Event } from 'h3'

/**
 * Demo seed/clear database path (AFC-1086).
 *
 * The super-admin demo routes run the versioned seed/clear scripts through
 * this pool and write a `demo_admin_actions` audit row with the actor and
 * per-table row counts. The pool connects with `demoDatabaseUrl`, a
 * staging-only migrator-capable credential: the app role (`directus_app`)
 * holds no DELETE anywhere, so it can never clear. Absent configuration
 * (every production deployment) fails the route with a named 503 before
 * any SQL runs.
 *
 * The scripts stay the implementation: this module loads the same
 * `services/directus/seeds/demo/*.sql` files the operator runs with psql,
 * so the API and the documented psql path cannot drift. When the seed
 * directory is not installed beside the server (e.g. a production build
 * that must not carry it), the route answers 503 instead of running
 * anything.
 */

const CONFIRM_PHRASE = 'DELETE DEMO DATA'

let pool: Pool | null = null

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function demoPool(event: H3Event): Pool {
  if (pool) return pool
  const config = useRuntimeConfig(event)
  const connectionString = String(config.demoDatabaseUrl ?? '')
  if (!connectionString) {
    throw createError({
      statusCode: 503,
      statusMessage: 'Demo seeding is not configured for this deployment',
      data: { code: 'demo_not_configured' },
    })
  }
  pool = new Pool({ connectionString, max: 1 })
  return pool
}

function seedDir(): string {
  const here = dirname(fileURLToPath(import.meta.url))
  const candidates = [
    // Source checkout, server cwd at apps/web (nuxt dev).
    resolve(process.cwd(), 'services/directus/seeds/demo'),
    resolve(process.cwd(), '..', 'services/directus/seeds/demo'),
    resolve(process.cwd(), '..', '..', 'services/directus/seeds/demo'),
    // Relative to this file in a source checkout (apps/web/server/utils).
    resolve(here, '..', '..', '..', '..', 'services/directus/seeds/demo'),
  ]
  for (const dir of candidates) {
    if (existsSync(resolve(dir, '001_demo_seed.sql'))) return dir
  }
  throw createError({
    statusCode: 503,
    statusMessage: 'Demo seed scripts are not installed beside the server',
    data: { code: 'demo_seed_not_installed' },
  })
}

function loadScript(name: string): string {
  const sql = readFileSync(resolve(seedDir(), name), 'utf8')
  // Belt-and-braces: never run a file that is not the reviewed script.
  if (!sql.includes('demo_seed_registry') || !sql.includes('AFC-1086')) {
    throw createError({
      statusCode: 503,
      statusMessage: 'Demo seed script failed its identity check',
      data: { code: 'demo_seed_rejected' },
    })
  }
  return sql
}

export interface DemoCounts {
  tables: Record<string, number>
  total: number
}

async function registryCounts(client: {
  query: (text: string) => Promise<{ rows: Array<{ table_name: string; n: string }> }>
}): Promise<DemoCounts> {
  const res = await client.query(
    `SELECT table_name, count(*)::text AS n FROM demo_seed_registry GROUP BY table_name ORDER BY table_name`,
  )
  const tables: Record<string, number> = {}
  for (const row of res.rows) tables[row.table_name] = Number(row.n)
  const total = Object.values(tables).reduce((a, b) => a + b, 0)
  return { tables, total }
}

function actorId(scopeUserId: string): string {
  if (!UUID_RE.test(scopeUserId)) {
    throw createError({
      statusCode: 500,
      statusMessage: 'Demo audit actor is not a valid user id',
      data: { code: 'demo_actor_invalid' },
    })
  }
  return scopeUserId
}

export async function runDemoSeed(
  event: H3Event,
  scopeUserId: string,
): Promise<DemoCounts> {
  const actor = actorId(scopeUserId)
  const client = await demoPool(event).connect()
  try {
    await client.query('BEGIN')
    try {
      await client.query(loadScript('001_demo_seed.sql'))
      const counts = await registryCounts(client)
      await client.query(
        `INSERT INTO demo_admin_actions (action, actor_user, detail)
         VALUES ('seed', $1::uuid, $2::jsonb)`,
        [actor, JSON.stringify({ tables: counts.tables, total: counts.total })],
      )
      await client.query('COMMIT')
      return counts
    } catch (cause) {
      await client.query('ROLLBACK')
      throw cause
    }
  } finally {
    client.release()
  }
}

export async function runDemoClear(
  event: H3Event,
  scopeUserId: string,
  confirmPhrase: unknown,
): Promise<DemoCounts> {
  if (confirmPhrase !== CONFIRM_PHRASE) {
    throw createError({
      statusCode: 400,
      statusMessage: `Type ${CONFIRM_PHRASE} to clear the demo data`,
      data: { code: 'confirmation_required' },
    })
  }
  const actor = actorId(scopeUserId)
  const client = await demoPool(event).connect()
  try {
    await client.query('BEGIN')
    try {
      // Capture before the clear deletes the registry rows: the pre-counts
      // are the removed counts the audit row reports.
      const removed = await registryCounts(client)
      await client.query(loadScript('002_demo_clear.sql'))
      await client.query(
        `INSERT INTO demo_admin_actions (action, actor_user, detail)
         VALUES ('clear', $1::uuid, $2::jsonb)`,
        [actor, JSON.stringify({ tables: removed.tables, total: removed.total })],
      )
      await client.query('COMMIT')
      return removed
    } catch (cause) {
      await client.query('ROLLBACK')
      throw cause
    }
  } finally {
    client.release()
  }
}
