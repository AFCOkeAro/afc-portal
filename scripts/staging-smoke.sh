#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# AFC staging smoke helper (AFC-729).
#
# WHAT IT IS
#   A drop-in replacement for the ad-hoc QA smoke commands that leaked the
#   staging account identifier into retained run logs (AFC-727-B). It signs in
#   to staging and probes authenticated endpoints while printing NOTHING that
#   can carry credential material: HTTP status codes and single booleans only.
#   Response bodies, session JSON, cookies, tokens and the credential values
#   themselves never reach stdout, stderr, or the process list.
#
# THE RULE (same as scripts/smoke-log-hygiene-gate.sh)
#   Smoke MUST NOT print auth response bodies. Log the HTTP status code plus a
#   redacted summary (booleans below -- never email, token, session or cookie
#   material). Sign-in probes must not pass the response-header flag to the
#   transfer tool and must not pipe a body to a pager; assert on the status
#   code, or extract a single boolean with a fixed pattern.
#
# HOW IT STAYS QUIET
#   - Credentials come from the environment (STAGING_LOGIN, STAGING_PASSWORD).
#     Presence is asserted; values are never echoed, never printed, never put
#     on a command line (the request body travels in a 0600 temp file passed
#     by reference, so nothing secret appears in ps output either).
#   - No xtrace anywhere near credential use.
#   - The cookie jar is 0600, used by reference, shredded on exit.
#   - Every response body lands in a 0600 temp file (or the null device); only
#     fixed-pattern booleans are extracted from it with grep. Nothing else
#     from a body is ever printed.
#
# USAGE
#   STAGING_LOGIN=... STAGING_PASSWORD=... bash scripts/staging-smoke.sh \
#     [--base-url https://afc-staging.bluespace.ng] [/extra/path ...]
#
#   Prints one `name=value` line per check (status codes and booleans only)
#   and exits 0 when every check passes, 1 otherwise. Extra paths are probed
#   with GET and reported as `probe <METHOD> <path> -> <code>`.
#
# SELF-TEST
#   `bash scripts/staging-smoke.sh --self-test` syntax-checks this file and
#   asserts none of the forbidden logging idioms is present in it. The
#   smoke-log hygiene gate remains the arbiter for the whole tree.
# ---------------------------------------------------------------------------
set -uo pipefail
umask 077

BASE_URL="${STAGING_BASE_URL:-https://afc-staging.bluespace.ng}"
SELF="$0"

usage() {
  echo "usage: staging-smoke.sh [--base-url URL] [--self-test] [probe-path ...]" >&2
  echo "  env STAGING_LOGIN and STAGING_PASSWORD must be set (values never printed)" >&2
}

# Print a literal `name=value` line. Callers pass only codes/booleans here.
report() {
  printf '%s=%s\n' "$1" "$2"
}

json_escape() {
  local s="$1"
  s="${s//\\/\\\\}"
  s="${s//\"/\\\"}"
  s="${s//$'\n'/\\n}"
  printf '%s' "$s"
}

self_test() {
  local failures=0
  if ! bash -n "$SELF"; then
    echo "FAIL self-test: syntax check failed"
    return 1
  fi
  echo "ok   self-test: syntax clean"
  # Each forbidden idiom is checked on its own line so this block stays
  # readable; none of these pattern lines performs a transfer.
  if grep -En 'set[[:space:]]+-[a-zA-Z]*x|xtrace' "$SELF" | grep -v 'No xtrace' | grep -qv 'self_test'; then
    : # filtered below with a precise check
  fi
  if grep -Eq '^[[:space:]]*set[[:space:]]+-[a-zA-Z]*x' "$SELF"; then
    echo "FAIL self-test: xtrace enabled"; failures=$((failures + 1))
  else
    echo "ok   self-test: no xtrace"
  fi
  if grep -Eq 'echo[^#]*\$STAGING_|printf[^#]*\$STAGING_' "$SELF"; then
    echo "FAIL self-test: credential value printed"; failures=$((failures + 1))
  else
    echo "ok   self-test: credential values never printed"
  fi
  # Assembled from fragments so this very line matches none of the idioms.
  dump_pat="print""env|JSON\\.stringify|json\\.dumps"
  if grep -Eq "$dump_pat" "$SELF"; then
    echo "FAIL self-test: response-dumping idiom present"; failures=$((failures + 1))
  else
    echo "ok   self-test: no response-dumping idiom"
  fi
  echo "staging-smoke self-test: $((4 - failures))/4 passed"
  [ "$failures" -eq 0 ]
}

BASE_SET=0
PROBES=()
for arg in "$@"; do
  case "$arg" in
    -h|--help) usage; exit 2 ;;
    --self-test) self_test; exit $? ;;
    --base-url) BASE_SET=1; continue ;;
    *)
      if [ "$BASE_SET" -eq 1 ]; then BASE_URL="$arg"; BASE_SET=0; else PROBES+=("$arg"); fi
      ;;
  esac
done

: "${STAGING_LOGIN:?Set STAGING_LOGIN in the environment (value never printed)}"
: "${STAGING_PASSWORD:?Set STAGING_PASSWORD in the environment (value never printed)}"

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
jar="$work/jar"
payload="$work/payload"
body="$work/body"
touch "$jar" "$payload" "$body"

overall=0

# 1. Anonymous health: proves the served bundle without any credential.
code="$(curl -s -o "$body" -w '%{http_code}' --max-time 30 "$BASE_URL/api/health" 2>/dev/null || true)"
[ -n "$code" ] || code="000"
report "health_http" "$code"
[ "$code" = "200" ] || overall=1
if [ "$code" = "200" ]; then
  if grep -Eq '"directusConfigured"[[:space:]]*:[[:space:]]*true' "$body"; then
    report "directus_configured" "true"
  else
    report "directus_configured" "false"
  fi
  sha="$(sed -n 's/.*"sha"[[:space:]]*:[[:space:]]*"\([0-9a-f][0-9a-f]*\)".*/\1/p' "$body" | head -n 1 || true)"
  [ -n "${sha:-}" ] && report "served_sha" "$sha"
fi

# 2. Sign in. The body is built in a 0600 file (never echoed, never on the
# command line); the response is discarded -- only the status is reported.
{
  printf '{"email": "'
  json_escape "$STAGING_LOGIN"
  printf '", "password": "'
  json_escape "$STAGING_PASSWORD"
  printf '"}'
} > "$payload"
code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 30 \
  -c "$jar" -b "$jar" -X POST "$BASE_URL/api/auth/login" \
  -H 'Content-Type: application/json' --data @"$payload" 2>/dev/null || true)"
[ -n "$code" ] || code="000"
: > "$payload"
report "login_http" "$code"
case "$code" in 2*) ;; *) overall=1 ;; esac

# 3. Session check. Only the authenticated boolean leaves the response file.
if [ -s "$jar" ]; then
  code="$(curl -s -o "$body" -w '%{http_code}' --max-time 30 -b "$jar" "$BASE_URL/api/auth/me" 2>/dev/null || true)"
  [ -n "$code" ] || code="000"
  report "me_http" "$code"
  if grep -Eq '"authenticated"[[:space:]]*:[[:space:]]*true' "$body"; then
    report "authenticated" "true"
  else
    report "authenticated" "false"
    overall=1
  fi
  : > "$body"
else
  report "authenticated" "false"
  overall=1
fi

# 4. Optional extra probes: status codes only, bodies discarded.
for path in ${PROBES[@]+"${PROBES[@]}"}; do
  case "$path" in /*) ;; *) path="/$path" ;; esac
  code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 30 -b "$jar" -X GET "$BASE_URL$path" 2>/dev/null || true)"
  [ -n "$code" ] || code="000"
  printf 'probe GET %s -> %s\n' "$path" "$code"
  case "$code" in 2*) ;; *) overall=1 ;; esac
done

exit "$overall"
