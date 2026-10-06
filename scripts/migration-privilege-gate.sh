#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# AFC migration privilege boundary gate.
#
# WHY THIS EXISTS
#   ADR-0002. Roles are provisioned by the bootstrap step that runs as the
#   cluster owner, BEFORE the migration sequence. A migration may GRANT and
#   REVOKE; it may never CREATE ROLE.
#
#   This is a class defect, not a per-file one. 20261006_0004_retention.sql was
#   the first migration that needed a new role and failed with:
#
#     permission denied to create role   code: 42501
#
#   Nothing in the suite said "you cannot do that here" -- the author found out
#   from Postgres, at migrate time. This gate is that message, delivered in CI.
#
# WHY NOT JUST GRANT CREATEROLE TO THE MIGRATOR
#   Because CREATEROLE permits granting membership in any non-superuser role, so
#   the migration identity could promote itself to directus_app and escalate to
#   full read/write on the application database. That makes the suite green and
#   the least-privilege model a fiction. See ADR-0002, Alternatives.
#
# CONTRACT
#   exit 0 -> no role creation under services/directus/schema/migrations/.
#   exit 1 -> violation. Prints file:line and the offending text.
#
# GRANDFATHERED, AND WHY IT IS AN ERROR NOT AN EXEMPTION
#   20261006_0001_incidents.sql still creates directus_migrator and
#   directus_app. It is where the split was introduced and it is already applied
#   schema history. Removing it means editing applied history on a legal-evidence
#   surface, which is a one-way door. Tracked in AFC-173 rather than silently
#   allowed -- so this gate FAILS until 0001 is migrated, which is the honest
#   state: the rule is not yet satisfied by the tree, and the gate should say so
#   rather than pretend. Until then CI is red on this check and that is correct.
#
# SELF-TEST
#   A gate nobody has watched fail is a gate nobody can trust. --self-test builds
#   a throwaway tree with a known violation and asserts the scanner REJECTS it,
#   and asserts a clean tree is ACCEPTED.
# ---------------------------------------------------------------------------
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT" || exit 2

MIGRATIONS="services/directus/schema/migrations"

# CREATE ROLE / CREATE USER, plus the two statements that would grant a role the
# ability to create or escalate to another role. Those are the same boundary
# violation wearing different syntax, so they are caught here too rather than
# discovered at deploy time.
PATTERNS=(
  "CREATE[[:space:]]+ROLE"
  "CREATE[[:space:]]+USER"
  "GRANT[[:space:]]+CREATEROLE"
  "ALTER[[:space:]]+ROLE[^;]*SUPERUSER"
)

scan() {
  local base="${1:-$MIGRATIONS}"
  local rc=0 f

  [ -d "$base" ] || return 0

  while IFS= read -r f; do
    [ -n "$f" ] || continue
    # rollback/ is a reversal path run by an operator, not part of the forward
    # sequence, and it inherits whatever role ran the corresponding migration.
    case "$f" in
      */rollback/*) continue ;;
    esac

    local p
    for p in "${PATTERNS[@]}"; do
      local hit
      hit=$(grep -nEi "$p" "$f" 2>/dev/null) || continue
      [ -n "$hit" ] || continue
      rc=1
      echo "  $f"
      while IFS= read -r line; do
        echo "      $line"
      done <<< "$hit"
    done
  done < <(find "$base" -type f -name '*.sql' 2>/dev/null | sort)

  return $rc
}

self_test() {
  local tmp rc=0
  tmp=$(mktemp -d)
  trap 'rm -rf "$tmp"' RETURN
  mkdir -p "$tmp/migrations/rollback"

  # 1. A known violation MUST be rejected. Inside a DO block, which is how the
  #    real 0004 wrote it.
  cat > "$tmp/migrations/bad.sql" <<'EOF'
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'retention_worker') THEN
    CREATE ROLE retention_worker NOLOGIN;
  END IF;
END $$;
EOF
  if scan "$tmp/migrations" >/dev/null 2>&1; then
    echo "SELF-TEST FAIL: scanner accepted CREATE ROLE inside a DO block"
    rc=1
  else
    echo "  self-test ok: CREATE ROLE in a DO block rejected"
  fi

  # 1b. GRANT CREATEROLE is the same violation and must be caught too.
  rm -f "$tmp/migrations/bad.sql"
  echo "GRANT CREATEROLE TO directus_migrator;" > "$tmp/migrations/escalate.sql"
  if scan "$tmp/migrations" >/dev/null 2>&1; then
    echo "SELF-TEST FAIL: scanner accepted GRANT CREATEROLE"
    rc=1
  else
    echo "  self-test ok: GRANT CREATEROLE rejected"
  fi

  # 2. A clean migration MUST be accepted. GRANT/REVOKE are exactly what a
  #    migration is allowed to do.
  rm -f "$tmp/migrations/escalate.sql"
  cat > "$tmp/migrations/good.sql" <<'EOF'
GRANT USAGE ON SCHEMA public TO retention_worker;
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM retention_worker;
REVOKE DELETE, TRUNCATE ON ALL TABLES IN SCHEMA public FROM directus_app;
GRANT SELECT ON retention_policies TO retention_worker;
EOF
  if scan "$tmp/migrations" >/dev/null 2>&1; then
    echo "  self-test ok: GRANT/REVOKE-only migration accepted"
  else
    echo "SELF-TEST FAIL: scanner rejected a GRANT/REVOKE-only migration"
    rc=1
  fi

  # 3. The rollback directory is a reversal path, not the forward sequence.
  echo "CREATE ROLE should_not_here NOLOGIN;" > "$tmp/migrations/rollback/x.down.sql"
  if scan "$tmp/migrations" >/dev/null 2>&1; then
    echo "  self-test ok: rollback path excluded"
  else
    echo "SELF-TEST FAIL: scanner scanned the rollback path"
    rc=1
  fi

  return $rc
}

if [ "${1:-}" = "--self-test" ]; then
  echo "Migration privilege boundary gate self-test"
  self_test
  exit $?
fi

if scan "$MIGRATIONS"; then
  rc=0
else
  rc=1
  cat <<'MSG'

FAIL: a migration tries to create or escalate a role.

Roles are provisioned by the bootstrap step that runs as the cluster owner,
BEFORE the migration sequence (ADR-0002). A migration may GRANT and REVOKE; it
may never CREATE ROLE.

The reason this is not fixed by granting CREATEROLE to directus_migrator: in
PostgreSQL 16 that attribute permits granting membership in any non-superuser
role, so the migration identity could promote itself to directus_app and
escalate to full read/write on the application database. That turns the suite
green and the least-privilege model into a fiction.

To fix this:
  1. Add the role to the bootstrap step in scripts/run-db-tests.mjs.
  2. Have the migration only GRANT/REVOKE against the role it now assumes exists.
  3. Re-run this gate.
MSG
fi
exit $rc