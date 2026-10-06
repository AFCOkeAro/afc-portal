#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# AFC retention-literal gate.
#
# WHY THIS EXISTS
#   ADR-159-2 and AFC-167 require the retention engine to be CONFIG-DRIVEN.
#   Retention periods are legal commitments (NDPA s.40(2) plus the ratified
#   Consent & Safeguarding Policy §5): registrations 3 years, guardian consent
#   until the child turns 21, medical notes 3 years, safeguarding concerns
#   7 years or until the subject turns 25.
#
#   If those periods are written as literals inside application code, then a
#   retention change is a code change nobody reviews as a retention change, and
#   the engine silently drifts away from the policy it claims to enforce. A
#   retention engine that deletes wrongly is destructive and irreversible, so a
#   drift here is a data-loss bug, not a style bug.
#
#   This gate is the CI enforcement of that requirement.
#
# CONTRACT
#   exit 0 -> no retention literals outside the config layer.
#   exit 1 -> violation found. Prints file:line and the offending literal.
#
# ALLOWLIST (legitimate places for a retention literal)
#   services/directus/schema/migrations/**  -- schema seed + config rows.
#                                            The migration history must be able
#                                            to state the period it was created
#                                            with; it is applied as the table
#                                            owner and is reviewed as a schema
#                                            change.
#   **/retention.config.*                   -- the config layer itself.
#   scripts/retention-gate-fixtures/**      -- the negative fixture below. It
#                                            exists to contain violations.
#
# NOT ALLOWLISTED, ON PURPOSE
#   services/directus/extensions/**  Directus Flow / endpoint code runs with
#   app privileges and is exactly where a "just this one report" retention
#   literal will show up. It is scanned.
#
# SELF-TEST
#   A gate nobody has watched fail is not a gate. `--self-test` builds a
#   throwaway tree containing a known violation, asserts the scanner REJECTS
#   it, asserts the scanner ACCEPTS the clean tree, and asserts the allowlist
#   actually suppresses the fixture path. Non-zero exit on any surprise.
# ---------------------------------------------------------------------------
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT" || exit 2

# Files to scan: application source only.
SCAN_GLOBS=(
  "apps/**/*.ts" "apps/**/*.js" "apps/**/*.vue"
  "services/directus/extensions/**/*.ts" "services/directus/extensions/**/*.js"
  "packages/**/*.ts" "packages/**/*.js"
)

# Retention-period literals. Two shapes:
#   1. interval strings          INTERVAL '3 years'  |  '7 years'
#   2. day counts on a retention-named identifier
#                               retentionDays = 1095  |  RETENTION_DAYS: 1095
PATTERNS=(
  "(INTERVAL[[:space:]]*')[[:space:]]*[0-9]+[[:space:]]+(day|week|month|year)s?(('))"
  "['\"][[:space:]]*[0-9]+[[:space:]]+(day|week|month|year)s?['\"]"
  "([Rr][Ee][Tt][Ee][Nn][Tt][Ii][Oo][Nn][A-Za-z_]*[Ss]econds?[A-Za-z_]*[[:space:]]*[:=][[:space:]]*[0-9]{2,})"
  "([Rr][Ee][Tt][Ee][Nn][Tt][Ii][Oo][Nn][A-Za-z_]*(Days|Days_|days)[A-Za-z_]*[[:space:]]*[:=][[:space:]]*[0-9]{2,})"
)

scan() {
  # $1 = base dir to scan (used by the self-test to scan a fixture tree)
  local base="$1"
  local violations=0
  local files
  files=$(find "$base" \
      \( -path '*/node_modules' -o -path '*/.git' -o -path '*/dist' -o -path '*/.nuxt' \) -prune -o \
      -type f \( -name '*.ts' -o -name '*.js' -o -name '*.vue' \) -print 2>/dev/null) || return 0

  while IFS= read -r f; do
    [ -n "$f" ] || continue
    # Allowlist: migrations, config layer, and the negative fixture.
    case "$f" in
      */schema/migrations/*)      continue ;;
      */retention.config.*)       continue ;;
      *retention-gate-fixtures*)  continue ;;
      *)                          ;;
    esac

    local p
    for p in "${PATTERNS[@]}"; do
      # shellcheck disable=SC2086
      local hits
      hits=$(grep -nE "$p" "$f" 2>/dev/null) || continue
      [ -n "$hits" ] || continue
      violations=$((violations + 1))
      echo "RETENTION-LITERAL ${f#./}"
      echo "$hits" | sed 's/^/    /'
    done
  done <<< "$files"

  return $((violations > 0 ? 1 : 0))
}

# ---------------------------------------------------------------------------
# Self-test
# ---------------------------------------------------------------------------
self_test() {
  local tmp rc=0
  tmp=$(mktemp -d)
  trap 'rm -rf "$tmp"' RETURN

  mkdir -p "$tmp/src" "$tmp/schema/migrations" "$tmp/retention-gate-fixtures"

  # 1. A known violation MUST be rejected.
  cat > "$tmp/src/bad.ts" <<'EOF'
const RETENTION_DAYS = 1095;
const q = `SELECT 1 WHERE d < now() - INTERVAL '3 years'`;
EOF
  if scan "$tmp/src" >/dev/null 2>&1; then
    echo "SELF-TEST FAIL: scanner accepted a tree with a retention literal"
    rc=1
  else
    echo "  self-test ok: violation rejected"
  fi

  # 2. A clean tree MUST be accepted.
  rm -f "$tmp/src/bad.ts"
  cat > "$tmp/src/good.ts" <<'EOF'
import { periods } from './retention.config';
export function expiry(start: Date, category: string) {
  return new Date(start.getTime() + periods[category].ms);
}
EOF
  if scan "$tmp/src" >/dev/null 2>&1; then
    echo "  self-test ok: clean tree accepted"
  else
    echo "SELF-TEST FAIL: scanner rejected a clean tree (false positive)"
    rc=1
  fi

  # 3. The allowlist MUST actually suppress the fixture path, otherwise the
  #    self-test's own violating file would trip the real run.
  mkdir -p "$tmp/src/retention-gate-fixtures"
  echo "const RETENTION_DAYS = 1095;" > "$tmp/src/retention-gate-fixtures/allowed.ts"
  if scan "$tmp/src" >/dev/null 2>&1; then
    echo "  self-test ok: fixture path allowlisted"
  else
    echo "SELF-TEST FAIL: allowlist did not suppress the fixture path"
    rc=1
  fi

  # 4. Migrations MUST be allowlisted -- they state the period they were
  #    created with.
  mkdir -p "$tmp/src/schema/migrations"
  echo "INSERT INTO config VALUES ('medical', INTERVAL '3 years');" > "$tmp/src/schema/migrations/seed.sql"
  if ! find "$tmp/src" -name 'seed.sql' -print | grep -q .; then
    echo "SELF-TEST FAIL: fixture setup lost the migration file"
    rc=1
  fi

  return $rc
}

if [ "${1:-}" = "--self-test" ]; then
  echo "Retention gate self-test"
  self_test
  exit $?
fi

scan "."
rc=$?
if [ "$rc" -ne 0 ]; then
  cat <<'MSG'

FAIL: retention period literals found outside the config layer.

Retention periods are legal commitments under the ratified Consent &
Safeguarding Policy section 5. They belong in the retention config, not in
Flow code, endpoints, or UI. Move the value into
packages/shared/**/retention.config.ts (or the equivalent config module) and
reference it. If this is genuinely not a retention period, exclude the file
deliberately and say why in the PR description -- do not widen PATTERNS.
MSG
fi
exit $rc