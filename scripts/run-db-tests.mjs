#!/usr/bin/env node
// scripts/run-db-tests.mjs
//
// Runs the database control tests for incidents.awareness_at (AFC-166).
//
//   pnpm test:db                    local: an in-process PostgreSQL 16
//   PG_URL=postgres://... pnpm test:db
//                                    CI: an existing instance
//
// One code path, so local and CI assert the same things.
//
// The instance is bootstrapped the way production has to be bootstrapped:
// migrations run as directus_migrator, which owns the tables, while Directus
// connects as directus_app, which owns nothing. If those were the same role the
// guard trigger would be one DISABLE TRIGGER away from gone and these tests
// would not be able to tell.
//
// Local mode uses PGlite (PostgreSQL 16 compiled to WebAssembly) because the
// dev sandbox has no container runtime and initdb refuses to run as root. CI
// runs the identical suite against a real postgres:16 service container. The
// semantics under test -- column-level grants, DISABLE TRIGGER ownership,
// TRUNCATE bypassing row triggers -- are the same in both.

import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MIGRATIONS = join(REPO, 'services/directus/schema/migrations');
const TESTS = join(REPO, 'tests/db');

const log = (...a) => console.log(...a);

/** Two drivers behind one small interface: exec(multiStatement), query(sql).rows */
async function connect() {
  const external = process.env.PG_URL;
  if (external) {
    const { Client } = await import('pg');
    const client = new Client({ connectionString: external });
    await client.connect();
    const v = await client.query('SELECT version()');
    log(`Connected to ${new URL(external).host}`);
    log(`Server: ${v.rows[0].version}`);
    return {
      version: v.rows[0].version,
      exec: async (sql) => { await client.query(sql); },
      query: async (sql) => (await client.query(sql)).rows,
      close: async () => { await client.end(); },
    };
  }

  let PGlite;
  try {
    ({ PGlite } = await import('@electric-sql/pglite'));
  } catch {
    console.error('No PG_URL set and @electric-sql/pglite is not installed.');
    console.error('Run `pnpm install`, or set PG_URL to an existing PostgreSQL 16.');
    process.exit(2);
  }
  const db = new PGlite();
  const v = await db.query('SELECT version()');
  log('Local mode: in-process PostgreSQL, no service container, nothing left on disk');
  log(`Server: ${v.rows[0].version}`);
  return {
    version: v.rows[0].version,
    exec: async (sql) => { await db.exec(sql); },
    query: async (sql) => (await db.query(sql)).rows,
    close: async () => { await db.close(); },
  };
}

const loadSql = (p) => readFileSync(p, 'utf8');

// The suites use psql's \i to include a migration, so the files stay runnable
// with psql unchanged. Expand it here.
function expandIncludes(sql, depth = 0) {
  if (depth > 6) throw new Error('\\i nesting too deep');
  return sql.replace(/^[ \t]*\\i[ \t]+(\S+)[ \t]*$/gm, (_, rel) => {
    log(`      \\i ${rel}`);
    return expandIncludes(loadSql(resolve(REPO, rel)), depth + 1);
  });
}

async function main() {
  const db = await connect();
  let failed = 0;
  let passed = 0;

  try {
    // ---------------------------------------------------------------
    // Roles, as the bootstrap superuser. After this the migrations run as
    // directus_migrator and own everything they create.
    // ---------------------------------------------------------------
    log('\nBootstrapping roles');
    await db.exec(`
      DO $bootstrap$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'directus_migrator') THEN
          CREATE ROLE directus_migrator NOLOGIN;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'directus_app') THEN
          CREATE ROLE directus_app LOGIN;
        END IF;
      END
      $bootstrap$;

      -- PostgreSQL 15+ gives PUBLIC no CREATE on the public schema, so the
      -- migration role is granted it explicitly. The runtime role gets USAGE
      -- only: it reads and writes, it does not create objects.
      GRANT USAGE, CREATE ON SCHEMA public TO directus_migrator;
      GRANT USAGE ON SCHEMA public TO directus_app;
    `);

    // ---------------------------------------------------------------
    // Migrations, as the table owner.
    // ---------------------------------------------------------------
    const migrationFiles = readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort();
    log('\nApplying migrations as directus_migrator (table owner)');
    for (const file of migrationFiles) {
      try {
        await db.exec('SET ROLE directus_migrator');
        await db.exec(loadSql(join(MIGRATIONS, file)));
        log(`  ok   ${file}`);
      } catch (e) {
        console.error(`\n  FAIL ${file} did not apply\n       ${e.message}\n`);
        process.exitCode = 1;
        throw e;
      } finally {
        try { await db.exec('RESET ROLE'); } catch { /* connection is going away anyway */ }
      }
    }

    await db.exec(loadSql(join(TESTS, 'assert.sql')));

    // ---------------------------------------------------------------
    // Suites.
    // ---------------------------------------------------------------
    const testFiles = readdirSync(TESTS).filter((f) => /^\d\d_.*\.sql$/.test(f)).sort();
    log('\nRunning suites');
    for (const file of testFiles) {
      try {
        await db.exec(expandIncludes(loadSql(join(TESTS, file))));
        log(`  ok   ${file}`);
        passed++;
      } catch (e) {
        // position/where are what make a SQL failure locatable in a 200-line file
        const at = e.position ? ` (position ${e.position}${e.where ? `, ${e.where.trim()}` : ''})` : '';
        console.error(`  FAIL ${file}\n       ${e.message}${at}`);
        failed++;
      }
    }

    // ---------------------------------------------------------------
    // Assertion report.
    // ---------------------------------------------------------------
    const rows = await db.query(
      'SELECT suite, name, ok, detail FROM test_support.results ORDER BY seq',
    );
    log('\nAssertions');
    let suite = null;
    for (const r of rows) {
      if (r.suite !== suite) { suite = r.suite; log(`\n  [${suite}]`); }
      log(`   ${r.ok ? 'pass' : 'FAIL'}  ${r.name}`);
      if (!r.ok) log(`         ${r.detail}`);
    }
    const notOk = rows.filter((r) => !r.ok).length;
    log(`\n${passed} suites passed, ${failed} failed, ${rows.length} assertions, ${notOk} failing`);
    if (failed > 0 || notOk > 0) process.exitCode = 1;
  } finally {
    await db.close().catch(() => {});
  }
}

main().catch((e) => { console.error(e); process.exit(1); });