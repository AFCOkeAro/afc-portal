#!/usr/bin/env node
// ---------------------------------------------------------------------------
// DEPLOY_REGION provisioning check. AFC-211.
//
// WHAT THIS PROVES, AND WHY IT IS NOT THE SAME AS THE GATE'S OWN SELF-TEST
//   services/directus/bin/assert-deploy-region.sh --self-test proves the
//   assertion's LOGIC: every reject branch and every accept branch, with exact
//   exit codes. It does not prove that anything CALLS the assertion. A gate
//   nobody invokes is a gate that does not exist, and the wiring between
//   compose.yml and the script is exactly the kind of thing that rots silently
//   -- delete one `depends_on` line and every assertion in the file still
//   passes.
//
//   So this checks the other half, from the outside:
//
//     1. WIRING. Parses the resolved compose project and asserts every service
//        other than the guard itself declares the guard as a
//        `service_completed_successfully` dependency. If any service can start
//        without the assertion having run, this fails.
//     2. BEHAVIOUR, END TO END. Runs the guard's entrypoint exactly as compose
//        resolved it -- the same argv, the same environment variable name, the
//        same interpreter -- for unset, malformed, and well-formed inputs, and
//        asserts the exit code and that the message names DEPLOY_REGION.
//
//   Neither check can be satisfied by the script alone. Both can fail while
//   the script's self-test is green, which is the point: that is the
//   regression this file exists to catch.
//
// FAIL-CLOSED, INCLUDING ABOUT ITSELF
//   exit 0  every check passed.
//   exit 1  a check failed.
//   exit 2  the check could not run -- no compose, unparseable config, missing
//           guard service. That is NOT a pass. A guard that cannot see the
//           system does not get to say the system is fine. The same contract
//           scripts/dirty-path-guard.sh declares for itself.
//
// NO DEPLOY_REGION IS EVER SET BY THIS FILE. Every value it passes is a
// fixture with a deliberate synthetic country code, and none of them is a
// region. Supplying a real one here would defeat the issue this belongs to.
// ---------------------------------------------------------------------------

import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const DIRECTUS_DIR = resolve(HERE, '..')
const COMPOSE_FILE = join(DIRECTUS_DIR, 'compose.yml')

const GUARD = 'deploy-region'
const VAR = 'DEPLOY_REGION'
const REJECT = 78 // EX_CONFIG, matching the assertion.

let passed = 0
const failures = []

function ok(label) {
  passed += 1
  console.log(`  ok   ${label}`)
}

function fail(label, detail) {
  failures.push(`${label}: ${detail}`)
  console.log(`  FAIL ${label} -- ${detail}`)
}

function check(label, fn) {
  try {
    fn()
  } catch (err) {
    fail(label, err && err.message ? err.message : String(err))
  }
}

/** Run the guard entrypoint compose resolved, and capture code + output. */
function runGuard(env, argv) {
  try {
    const stdout = execFileSync(argv[0], argv.slice(1), {
      env,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    return { code: 0, output: stdout }
  } catch (err) {
    // A non-zero exit is the interesting case, not an exception.
    return {
      code: typeof err.status === 'number' ? err.status : 1,
      output: `${err.stdout || ''}${err.stderr || ''}`,
    }
  }
}

/** Resolve the compose project, trying the v2 plugin then the v1 binary. */
function resolveCompose() {
  const attempts = [
    ['docker', ['compose', '--project-directory', DIRECTUS_DIR, '-f', COMPOSE_FILE, 'config', '--format', 'json']],
    ['docker-compose', ['--project-directory', DIRECTUS_DIR, '-f', COMPOSE_FILE, 'config', '--format', 'json']],
  ]
  const tried = []
  for (const [cmd, args] of attempts) {
    try {
      const out = execFileSync(cmd, args, {
        env: { ...process.env },
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      })
      return { cmd, project: JSON.parse(out) }
    } catch (err) {
      tried.push(`${cmd}: ${(err.stderr || err.message || '').toString().trim().split('\n').pop()}`)
    }
  }
  const err = new Error(`no usable docker compose (${tried.join(' | ')})`)
  err.fatal = true
  throw err
}

console.log('DEPLOY_REGION provisioning check (AFC-211)')

let project
try {
  const resolved = resolveCompose()
  console.log(`  ..   compose resolved via ${resolved.cmd}`)
  project = resolved.project
} catch (err) {
  // Fail closed: unable to inspect the wiring is not the same as the wiring
  // being correct.
  console.error(`FATAL: ${err.message}`)
  console.error('The provisioning path cannot be verified. That is not a pass.')
  process.exit(2)
}

// --- 1. WIRING --------------------------------------------------------------
check(`${GUARD} service exists and runs the assertion`, () => {
  const svc = project.services?.[GUARD]
  if (!svc) throw new Error(`no service named ${GUARD} in ${COMPOSE_FILE}`)
  const entry = Array.isArray(svc.entrypoint) ? svc.entrypoint.join(' ') : String(svc.entrypoint ?? '')
  if (!entry.includes('assert-deploy-region.sh')) {
    throw new Error(`entrypoint does not run the assertion: "${entry}"`)
  }
  if (!Object.prototype.hasOwnProperty.call(svc.environment ?? {}, VAR)) {
    throw new Error(`${VAR} is not passed into the guard, so it can only ever see it unset`)
  }
  ok(`${GUARD} runs the assertion and receives ${VAR}`)
})

check('every other service is gated on the guard having succeeded', () => {
  const ungated = []
  for (const [name, svc] of Object.entries(project.services ?? {})) {
    if (name === GUARD) continue
    const dep = svc.depends_on?.[GUARD]
    if (!dep || dep.condition !== 'service_completed_successfully') {
      ungated.push(`${name} (${dep ? `condition=${dep.condition}` : 'no dependency'})`)
    }
  }
  if (ungated.length) {
    throw new Error(`these can start without the assertion running: ${ungated.join(', ')}`)
  }
  ok(`${Object.keys(project.services).length - 1} service(s) gated on ${GUARD}`)
})

check('the guard cannot restart-loop over a failure', () => {
  // restart: unless-stopped on a one-shot assertion turns one clear message
  // into an unbounded retry loop that buries it.
  const restart = project.services?.[GUARD]?.restart
  if (restart !== 'no') throw new Error(`restart is ${JSON.stringify(restart)}, expected "no"`)
  ok('guard restart is "no"')
})

check('the guard mounts the assertion read-only', () => {
  const svc = project.services?.[GUARD]
  const mount = (svc?.volumes ?? []).find((v) => String(v.target ?? v.source ?? '').includes('assert-deploy-region.sh'))
  if (!mount) throw new Error('the assertion is not mounted into the guard')
  if (mount.read_only !== true && !String(mount.source).endsWith(':ro')) {
    throw new Error('the assertion is mounted writable')
  }
  ok('assertion mounted read-only')
})

// --- 2. BEHAVIOUR, THROUGH THE RESOLVED ENTRYPOINT -------------------------
// argv and the variable name come from the resolved project, not from this
// file. If compose.yml ever changes how the guard is invoked, these checks
// follow the change instead of testing a stale copy of it.
const guardSvc = project.services[GUARD]
const argv = Array.isArray(guardSvc.entrypoint) ? [...guardSvc.entrypoint] : null
if (!argv) {
  fail('guard entrypoint is an exec form this harness cannot invoke', JSON.stringify(guardSvc.entrypoint))
} else {
  // The entrypoint paths are container paths. Run the same interpreter and the
  // same flags against the same script at its host path.
  argv[argv.length - 1] = join(DIRECTUS_DIR, 'bin', 'assert-deploy-region.sh')

  const base = { PATH: process.env.PATH }

  // AC2: unset refuses to start, and says which variable and where to set it.
  check(`${VAR} unset refuses to start (AC2)`, () => {
    const { code, output } = runGuard(base, argv)
    if (code !== REJECT) throw new Error(`expected exit ${REJECT}, got ${code}`)
    if (!output.includes(VAR)) throw new Error('message does not name DEPLOY_REGION')
    if (!/\.env/.test(output)) throw new Error('message does not say where to set it')
    ok(`unset -> exit ${REJECT}, names ${VAR} and services/directus/.env`)
  })

  // AC3: the .env.example placeholder shape is malformed, not a value.
  check(`${VAR}=XX:yyyy is rejected as malformed (AC3)`, () => {
    const { code, output } = runGuard({ ...base, [VAR]: 'XX:yyyy' }, argv)
    if (code !== REJECT) throw new Error(`expected exit ${REJECT}, got ${code}`)
    if (!output.includes(VAR)) throw new Error('message does not name DEPLOY_REGION')
    if (!/malformed/i.test(output)) throw new Error('message does not report the value as malformed')
    ok(`XX:yyyy -> exit ${REJECT}, reported malformed`)
  })

  // AC3: a well-formed value lets the stack proceed. 'QQ' is not an assigned
  // ISO 3166-1 alpha-2 code, so this fixture names no region.
  check(`${VAR} well-formed proceeds (AC3)`, () => {
    const { code, output } = runGuard({ ...base, [VAR]: 'QQ:abcd' }, argv)
    if (code !== 0) throw new Error(`expected exit 0, got ${code}: ${output.trim().split('\n')[0]}`)
    ok('QQ:abcd -> exit 0, gate passes')
  })
}

// --- 3. NO VALUE IN ANY COMMITTED FILE -------------------------------------
check(`no ${VAR} value is committed`, () => {
  // Two different things share the variable's name, and only one is a defect:
  //   - a LITERAL value, e.g. DEPLOY_REGION=QQ:abcd or DEPLOY_REGION: QQ:abcd.
  //     That is the failure this issue exists to prevent: someone typing a
  //     decision into a committed file.
  //   - a REFERENCE or a FIXTURE. `DEPLOY_REGION: ${DEPLOY_REGION}` is the env
  //     contract, and `DEPLOY_REGION="$_value"` inside the self-test is a
  //     synthetic fixture ('QQ' is not an assigned country code). Both are
  //     required for the check to work at all.
  //
  // So the rule is: the right-hand side must be empty, a reference, or a
  // fixture expansion. Empty is the correct committed state --
  // services/directus/.env.example ships exactly that, and AFC-171 made it so
  // deliberately.
  //
  // Matched at the START of a line (after optional indentation and `export`)
  // because that is the only shape an assignment takes in these three files:
  // a `.env` entry, a compose `environment:` key, or a shell assignment. A
  // read like `[ -z "${DEPLOY_REGION:-}" ]` is a use mid-line, and a shape that
  // only matches at line start cannot mistake a read for a written value.
  const files = [
    join(DIRECTUS_DIR, 'bin', 'assert-deploy-region.sh'),
    join(DIRECTUS_DIR, 'compose.yml'),
    join(DIRECTUS_DIR, '.env.example'),
  ]
  const assign = new RegExp(`^\\s*(?:export\\s+)?${VAR}\\s*[:=]\\s*(.*)$`)
  const offenders = []
  for (const file of files) {
    let src
    try {
      src = readFileSync(file, 'utf8')
    } catch {
      continue
    }
    src.split('\n').forEach((line, i) => {
      if (/^\s*#/.test(line)) return
      const m = line.match(assign)
      if (!m) return
      // Strip a trailing comment, then quotes. What is left is the value.
      const value = m[1].replace(/\s+#.*$/, '').trim().replace(/^["']|["']$/g, '').trim()
      // Empty, a `${...}` reference, or a fixture expansion: not a decision.
      if (value === '' || value.includes('$')) return
      offenders.push(`${file}:${i + 1}: ${line.trim()}`)
    })
  }
  if (offenders.length) {
    throw new Error(`${VAR} has a literal value in a committed file:\n    ${offenders.join('\n    ')}`)
  }
  ok(`${files.length} committed file(s) reference ${VAR} or leave it empty; none assigns a value`)
})

const total = passed + failures.length
console.log(`deploy-region provisioning check: ${passed}/${total} passed, ${failures.length} failed`)
if (failures.length) {
  console.error('FAILED:\n' + failures.map((f) => `  - ${f}`).join('\n'))
  process.exit(1)
}
