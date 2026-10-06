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
#   tests/db/**                             -- test fixtures. AFC-167 section 7
#                                            names test fixtures as an allowed
#                                            place, and a fixture cannot run in
#                                            production.
#   **/retention.config.*                   -- the config layer itself.
#   scripts/retention-gate-fixtures/**      -- the negative fixtures below. They
#                                            exist to contain violations.
#
# NOT ALLOWLISTED, ON PURPOSE
#   services/directus/schema/engine/**      The engine is where a duration is
#                                            most likely to reappear, because it
#                                            is the code that computes a due
#                                            date. It is scanned. This is the
#                                            whole point of keeping the engine
#                                            out of migrations/ in the first
#                                            place: migrations are exempt so a
#                                            migration can state its period, and
#                                            the engine is exempt from nothing.
#   services/directus/extensions/**  Directus Flow / endpoint code runs with
#                                    app privileges and is exactly where a "just
#                                    this one report" retention literal will show
#                                    up. It is scanned.
#
# SELF-TEST
#   A gate nobody has watched fail is not a gate. `--self-test` builds a
#   throwaway tree containing a known violation, asserts the scanner REJECTS
#   it, asserts the scanner ACCEPTS the clean tree, and asserts each allowlist
#   entry actually suppresses what it claims to suppress. Non-zero exit on any
#   surprise.
# ---------------------------------------------------------------------------
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT" || exit 2

# Files to scan: application source and SQL engine code. Extensions only --
# migrations and tests are excluded by the allowlist in scan(), not here,
# so that a new SQL file anywhere under services/ is scanned by default.
SCAN_GLOBS=(
  "apps/**/*.ts" "apps/**/*.js" "apps/**/*.vue" "apps/**/*.sql"
  "services/**/*.ts" "services/**/*.js" "services/**/*.sql"
  "packages/**/*.ts" "packages/**/*.js" "packages/**/*.sql"
)

# Retention-period literals. Four shapes:
#   1. interval strings          INTERVAL '3 years'  |  '7 years'
#   2. bare interval literals    interval '1095 days'  |  make_interval(days => 1095)
#   3. quoted durations          "3 years"  |  '18 months'
#   4. day counts on a retention-named identifier
#                               retentionDays = 1095  |  RETENTION_DAYS: 1095
#
# Shape 2 exists because the first version of this gate scanned only TS/JS/Vue
# and the engine is SQL. A gate that cannot see the file that computes the due
# date is not a gate on the schedule; it is a gate on the UI.
PATTERNS=(
  "(INTERVAL[[:space:]]*')[[:space:]]*[0-9]+[[:space:]]+(day|week|month|year)s?(('))"
  "[Ii][Nn][Tt][Ee][Rr][Vv][Aa][Ll][[:space:]]*'[[:space:]]*[0-9]+"
  "make_interval\(\s*(years|months|weeks|days)[[:space:]]*=>[[:space:]]*[0-9]+"
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
      -type f \( -name '*.ts' -o -name '*.js' -o -name '*.vue' -o -name '*.sql' \) -print 2>/dev/null) || return 0

  while IFS= read -r f; do
    [ -n "$f" ] || continue
    # Allowlist: migrations, test fixtures, config layer, and the fixtures.
    case "$f" in
      */schema/migrations/*)      continue ;;
      */tests/db/*)               continue ;;
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

  mkdir -p "$tmp/src" "$tmp/src/services/directus/schema/engine" \
           "$tmp/src/services/directus/schema/migrations" \
           "$tmp/src/tests/db" "$tmp/src/services/directus/extensions" \
           "$tmp/retention-gate-fixtures"

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

  # 1b. The engine is SQL, and a literal there is the exact failure this gate
  #     exists to prevent. A gate that cannot see it is a gate on nothing.
  rm -f "$tmp/src/bad.ts"
  cat > "$tmp/src/services/directus/schema/engine/0001_retention_engine.sql" <<'EOF'
CREATE FUNCTION retention.age_limit() RETURNS interval
  LANGUAGE sql IMMUTABLE AS $$ SELECT INTERVAL '21 years' $$;
EOF
  if scan "$tmp/src" >/dev/null 2>&1; then
    echo "SELF-TEST FAIL: scanner accepted a retention literal inside the SQL engine"
    rc=1
  else
    echo "  self-test ok: engine SQL literal rejected"
  fi
  rm -f "$tmp/src/services/directus/schema/engine/0001_retention_engine.sql"

  # 1c. A bare interval literal with no unit word must also be caught.
  cat > "$tmp/src/services/directus/schema/engine/0002_extra.sql" <<'EOF'
CREATE FUNCTION retention.purge_older_than() RETURNS timestamptz
  LANGUAGE sql AS $$ SELECT now() - interval '2555 days' $$;
EOF
  if scan "$tmp/src" >/dev/null 2>&1; then
    echo "SELF-TEST FAIL: scanner accepted a bare interval literal in the engine"
    rc=1
  else
    echo "  self-test ok: bare interval literal rejected"
  fi
  rm -f "$tmp/src/services/directus/schema/engine/0002_extra.sql"

  # 2. A clean tree MUST be accepted.
  cat > "$tmp/src/good.ts" <<'EOF'
import { periods } from './retention.config';
export function expiry(start: Date, category: string) {
  return new Date(start.getTime() + periods[category].ms);
}
EOF
  cat > "$tmp/src/services/directus/schema/engine/0001_retention_engine.sql" <<'EOF'
-- The engine reads the period from retention_policies and builds the interval
-- from that integer. It never names a duration.
CREATE FUNCTION retention.add_years(p_ts timestamptz, p_years integer)
RETURNS timestamptz LANGUAGE sql IMMUTABLE AS
  $$ SELECT p_ts + (p_years::text || ' years')::interval $$;
EOF
  if scan "$tmp/src" >/dev/null 2>&1; then
    echo "  self-test ok: clean tree accepted"
  else
    echo "SELF-TEST FAIL: scanner rejected a clean tree (false positive)"
    rc=1
  fi

  # 3. Migrations MUST be allowlisted -- they state the period they were
  #    created with, and the migration history has to be readable.
  cat > "$tmp/src/services/directus/schema/migrations/seed.sql" <<'EOF'
INSERT INTO config VALUES ('medical_notes', INTERVAL '3 years');
EOF
  if scan "$tmp/src" >/dev/null 2>&1; then
    echo "  self-test ok: migration path allowlisted"
  else
    echo "SELF-TEST FAIL: allowlist did not suppress the migration path"
    rc=1
  fi
  rm -f "$tmp/src/services/directus/schema/migrations/seed.sql"

  # 3b. Test fixtures MUST be allowlisted (AFC-167 section 7).
  cat > "$tmp/src/tests/db/fixture.sql" <<'EOF'
INSERT INTO retention_policies (floor_years) VALUES (7);
EOF
  if scan "$tmp/src" >/dev/null 2>&1; then
    echo "  self-test ok: test fixture path allowlisted"
  else
    echo "SELF-TEST FAIL: allowlist did not suppress the test fixture path"
    rc=1
  fi
  rm -f "$tmp/src/tests/db/fixture.sql"

  # 3c. The config layer MUST be allowlisted -- it is where a period is allowed
  #     to be written down.
  cat > "$tmp/src/retention.config.ts" <<'EOF'
export const REGISTRATION_PERIOD = '3 years';
EOF
  if scan "$tmp/src" >/dev/null 2>&1; then
    echo "  self-test ok: config layer allowlisted"
  else
    echo "SELF-TEST FAIL: allowlist did not suppress the config layer"
    rc=1
  fi
  rm -f "$tmp/src/retention.config.ts"

  # 3d. Directus extensions are NOT allowlisted. This is the directory a "just
  #     this one report" retention literal will actually appear in.
  cat > "$tmp/src/services/directus/extensions/report-flow.ts" <<'EOF'
const KEEP = "18 months";
EOF
  if scan "$tmp/src" >/dev/null 2>&1; then
    echo "SELF-TEST FAIL: scanner accepted a retention literal in a Directus extension"
    rc=1
  else
    echo "  self-test ok: Directus extension literal rejected"
  fi
  rm -f "$tmp/src/services/directus/extensions/report-flow.ts"

  # 4. The negative-fixture directory MUST actually be suppressed, otherwise
  #    the self-test's own violating file would trip the real run.
  mkdir -p "$tmp/src/retention-gate-fixtures"
  echo "const RETENTION_DAYS = 1095;" > "$tmp/src/retention-gate-fixtures/allowed.ts"
  if scan "$tmp/src" >/dev/null 2>&1; then
    echo "  self-test ok: fixture path allowlisted"
  else
    echo "SELF-TEST FAIL: allowlist did not suppress the fixture path"
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