/**
 * AFC-718 contract tests — build SHA in GET /api/health (staging SHA-proof).
 *
 * Pure node:test, no dependencies. Asserts the structural contract the
 * staging-verify flow is built on:
 *   1. Shape: the health route still returns status, app,
 *      directusConfigured, registrationOpen and at, and adds `sha`.
 *   2. Default: sha is 'unknown' when no SHA is configured (dev, local
 *      images built without the build arg).
 *   3. Source: sha prefers runtimeConfig.public.buildSha and falls back to
 *      the NUXT_PUBLIC_BUILD_SHA env var. No SHA is hard-coded.
 *   4. Plumbing: the Dockerfile accepts the SHA as a build arg, compose
 *      passes it at build and run time, .env.example documents the name
 *      with an empty value, and CI bakes github.sha into the build.
 *
 * Run: node --test tests/web/health-sha.contract.mjs
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const read = (rel) => readFileSync(path.join(root, rel), 'utf8')
const codeOf = (rel) =>
  read(rel)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*/g, '')

const ROUTE = 'apps/web/server/api/health.get.ts'
const DOCKERFILE = 'apps/web/Dockerfile'
const COMPOSE = 'services/staging/compose.yml'
const ENV_EXAMPLE = 'services/staging/.env.example'
const CI = '.github/workflows/ci.yml'

describe('AFC-718: GET /api/health exposes the build SHA', () => {
  it('keeps the existing fields byte-compatible and adds sha', () => {
    const code = codeOf(ROUTE)
    for (const field of [
      'status',
      'app',
      'directusConfigured',
      'registrationOpen',
      'at',
    ]) {
      assert.match(
        code,
        new RegExp(`\\b${field}\\b`),
        `health route still returns ${field}`,
      )
    }
    assert.match(code, /\bsha\b/, 'health route returns sha')
  })

  it("defaults sha to 'unknown' when nothing is configured", () => {
    const code = codeOf(ROUTE)
    assert.match(code, /'unknown'/, "sha falls back to 'unknown'")
  })

  it('reads the SHA from runtime config with an env fallback, never hard-coded', () => {
    const code = codeOf(ROUTE)
    assert.match(code, /buildSha/, 'sha prefers runtimeConfig.public.buildSha')
    assert.match(code, /NUXT_PUBLIC_BUILD_SHA/, 'sha falls back to NUXT_PUBLIC_BUILD_SHA')
    assert.doesNotMatch(
      code,
      /\b[0-9a-f]{40}\b/,
      'no hard-coded commit SHA in the health route',
    )
  })

  it('Dockerfile accepts the SHA as a build arg without a real value', () => {
    const code = codeOf(DOCKERFILE)
    assert.match(code, /ARG NUXT_PUBLIC_BUILD_SHA/, 'Dockerfile declares the build arg')
    assert.match(
      code,
      /ENV NUXT_PUBLIC_BUILD_SHA/,
      'Dockerfile passes it to the Nuxt build',
    )
    assert.doesNotMatch(
      code,
      /\b[0-9a-f]{40}\b/,
      'no hard-coded commit SHA in the Dockerfile',
    )
  })

  it('compose passes the SHA at build time and at run time', () => {
    const code = codeOf(COMPOSE)
    assert.match(
      code,
      /NUXT_PUBLIC_BUILD_SHA: \$\{NUXT_PUBLIC_BUILD_SHA:-\}/,
      'compose wires the var',
    )
  })

  it('.env.example documents the var as an empty placeholder', () => {
    const raw = read(ENV_EXAMPLE)
    const line = raw.split('\n').find((l) => l.startsWith('NUXT_PUBLIC_BUILD_SHA'))
    assert.ok(line !== undefined, '.env.example names NUXT_PUBLIC_BUILD_SHA')
    assert.equal(line.trim(), 'NUXT_PUBLIC_BUILD_SHA=', 'placeholder value stays empty')
  })

  it('CI bakes the built commit into the web build', () => {
    const code = codeOf(CI)
    assert.match(
      code,
      /NUXT_PUBLIC_BUILD_SHA/,
      'CI sets NUXT_PUBLIC_BUILD_SHA for the build',
    )
    assert.match(code, /github\.sha/, 'CI value is the built commit')
  })
})
