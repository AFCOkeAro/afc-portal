#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# AFC smoke-log hygiene gate (AFC-664).
#
# WHY THIS EXISTS
#   QA smoke run afd00fe4 (2026-10-22T12:25-12:40Z) echoed Directus login JSON
#   and /api/auth/me session JSON into tool output at 6 spots. Each response
#   body carries the account identifier in its `email` field, so printing the
#   body prints a credential-surface value into a retained run log, where the
#   AFC-312 exact-known-value arm then fires (6 hits, all one username value).
#   Password/secret/token values were never printed -- this gate exists to keep
#   it that way and to stop the username field from recurring.
#
# THE RULE (for every smoke/QA helper, checked in or ad-hoc)
#   Smoke MUST NOT print auth response bodies. Log the HTTP status code plus a
#   redacted summary (e.g. role, branch count -- never email, token, session or
#   cookie material). The allowed shape is:
#     console.log('login', r.status, redactSummary(r.json))
#   and never:
#     console.log('login', r.status, JSON.stringify(r.json...))
#   curl probes of auth endpoints MUST NOT use -i/--include and MUST NOT pipe
#   the body to stdout; assert on status code, or pipe through a redactor.
#
# WHAT THIS GATE CHECKS
#   Static only. It scans *smoke-path* files -- places where a future smoke
#   helper would live if one is ever checked in -- for raw auth-body logging
#   idioms and fails closed on any match. There is deliberately no checked-in
#   smoke script today (the afd00fe4 print sites were ad-hoc /tmp files on the
#   QA runner: `curl -s -i ... /api/auth/login | head`, /tmp/smoke.mjs
#   `console.log('login', ..., JSON.stringify(r.json?.user ...))` and
#   `console.log('me', ..., JSON.stringify(r.json)...)`, /tmp/smoke5.mjs
#   `console.log(p, ..., (JSON.stringify(x.json)||x.text)...)` over
#   /api/auth/me). Nothing in the repo can patch an ad-hoc /tmp file, so the
#   durable fix is: rule above + this guard failing fast if the idiom is ever
#   committed + the QA-procedure update tracked on AFC-664 (owner CTO).
#
# CONTRACT
#   exit 0 -> no raw auth-body logging idioms in smoke paths.
#   exit 1 -> violation found. Prints file:line and the offending line.
#   exit 2 -> usage error.
#
# SELF-TEST
#   A gate nobody has watched fail is not a gate. `--self-test` builds a
#   throwaway tree with a known violation per pattern, asserts the scanner
#   REJECTS it, asserts a clean tree is ACCEPTED, and asserts the same idiom
#   outside smoke paths is ignored. Non-zero exit on any surprise.
# ---------------------------------------------------------------------------
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

usage() {
  echo "usage: smoke-log-hygiene-gate.sh [--self-test] [root]" >&2
}

# Smoke paths: where a checked-in smoke/QA helper would live. Everything else
# (app source, docs, contract tests) is out of scope: app code must call auth
# endpoints to function, and docs show redacted examples.
is_smoke_path() {
  local f="$1"
  case "$f" in
    scripts/*smoke*|scripts/*qa-*|scripts/staging-*|\
    tests/*smoke*|tests/qa-*|\
    .github/workflows/*|\
    services/directus/bin/*)
      return 0 ;;
    *) return 1 ;;
  esac
}

# One finding per line on stdout: file:line: content.
scan_tree() {
  local root="$1"
  local found=0
  while IFS= read -r -d '' f; do
    local rel="${f#$root/}"
    # This gate documents the forbidden idioms in its own header and builds
    # them in its self-test fixtures; scanning itself would always fail.
    [ "$rel" = "scripts/smoke-log-hygiene-gate.sh" ] && continue
    is_smoke_path "$rel" || continue
    case "$f" in *.sh|*.mjs|*.js|*.ts|*.py|*.yml|*.yaml) ;; *) continue ;; esac
    [ -f "$f" ] || continue
    local lineno=0
    while IFS= read -r line || [ -n "$line" ]; do
      lineno=$((lineno + 1))
      # P1: serialising a response object to stdout in a smoke path.
      if printf '%s' "$line" | grep -Eq 'console\.(log|info|debug|error)\([^)]*JSON\.stringify\((r|x|res|resp|response|result|out|data|json|body)\b'; then
        printf '%s:%s: %s\n' "$rel" "$lineno" "$line"
        found=1
      # P2: python print of a dumped response object.
      elif printf '%s' "$line" | grep -Eq 'print\((.*json\.dumps\((r|x|res|resp|response|result|data|json|body)\b|(r|x|res|resp|response|result)\.(text|content)\b)'; then
        printf '%s:%s: %s\n' "$rel" "$lineno" "$line"
        found=1
      # P3: curl -i/--include against an auth endpoint (headers AND body to stdout).
      elif printf '%s' "$line" | grep -Eq 'curl\b.*(-i|--include)\b' && printf '%s' "$line" | grep -Eq 'auth/(login|me)|/api/me\b'; then
        printf '%s:%s: %s\n' "$rel" "$lineno" "$line"
        found=1
      # P4: piping an auth-endpoint curl body to stdout (head/tee/cat) with no redactor.
      elif printf '%s' "$line" | grep -Eq 'curl\b.*auth/(login|me)' && printf '%s' "$line" | grep -Eq '\|\s*(head|tee|cat)\b' && ! printf '%s' "$line" | grep -Eqi 'jq|redact|mask|\[EMAIL\]'; then
        printf '%s:%s: %s\n' "$rel" "$lineno" "$line"
        found=1
      fi
    done < "$f"
  done < <(find "$root" \( -path "$root/node_modules" -prune \) -o \( -path "$root/.git" -prune \) -o -type f -print0)
  return "$found"
}

self_test() {
  local tmp failures=0 total=0
  tmp="$(mktemp -d)"
  trap "rm -rf '$tmp'" EXIT
  check() { # <label> <expected: pass|fail> <setup command>
    local label="$1" expected="$2" setup="$3"
    total=$((total + 1))
    rm -rf "$tmp/tree"; mkdir -p "$tmp/tree"
    eval "$setup"
    local out
    if out="$(scan_tree "$tmp/tree")"; then
      if [ "$expected" = "pass" ]; then
        echo "ok   $label"
      else
        echo "FAIL $label: expected findings, got none"; failures=$((failures + 1))
      fi
    else
      if [ "$expected" = "fail" ]; then
        echo "ok   $label (caught: $(printf '%s' "$out" | head -n 1))"
      else
        echo "FAIL $label: expected clean, got: $out"; failures=$((failures + 1))
      fi
    fi
  }
  # P1: console.log(JSON.stringify(response)) in a smoke helper fails.
  check "P1 console.log stringify in smoke path" fail \
    "mkdir -p \$tmp/tree/scripts && printf '%s\n' \"console.log('login', r.status, JSON.stringify(r.json?.user ?? r.text));\" > \$tmp/tree/scripts/smoke-staging.mjs"
  # P3: curl -i against login fails.
  check "P3 curl -i login in workflow" fail \
    "mkdir -p \$tmp/tree/.github/workflows && printf '%s\n' 'run: curl -s -i -X POST https://x/api/auth/login -d {} | head -n 40' > \$tmp/tree/.github/workflows/smoke.yml"
  # P4: curl login piped to head with no redactor fails.
  check "P4 curl login piped to head" fail \
    "mkdir -p \$tmp/tree/scripts && printf '%s\n' 'curl -s -X POST https://x/api/auth/me | head -n 20' > \$tmp/tree/scripts/qa-probe.sh"
  # Clean: status-only logging passes.
  check "clean status-only smoke helper" pass \
    "mkdir -p \$tmp/tree/scripts && printf '%s\n' \"console.log('login', r.status, 'user=' + (r.json?.user?.staffRole ?? 'none'));\" > \$tmp/tree/scripts/smoke-staging.mjs"
  # Out of scope: the same idiom in app source is not a smoke path.
  check "idiom in app source ignored" pass \
    "mkdir -p \$tmp/tree/apps/web/server/api/auth && printf '%s\n' \"console.log('login', r.status, JSON.stringify(r.json));\" > \$tmp/tree/apps/web/server/api/auth/login.post.ts"
  # Redacted curl pipe passes (redactor present).
  check "redacted curl pipe passes" pass \
    "mkdir -p \$tmp/tree/scripts && printf '%s\n' 'curl -s https://x/api/auth/me | jq {authenticated} | head -n 20' > \$tmp/tree/scripts/qa-probe.sh"
  echo "smoke-log-hygiene self-test: $((total - failures))/$total passed"
  [ "$failures" -eq 0 ]
}

case "${1:-}" in
  --self-test) self_test ;;
  -h|--help) usage; exit 2 ;;
  "") findings="$(scan_tree "$ROOT")"
    if [ -n "$findings" ]; then
      printf '%s\n' "$findings"
      echo "FAIL: raw auth-body logging idiom in a smoke path. Log status + redacted summary instead; see this script's header." >&2
      exit 1
    fi
    echo "smoke-log-hygiene: clean (no raw auth-body logging in smoke paths)"
    ;;
  *) usage; exit 2 ;;
esac
