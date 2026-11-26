#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# AFC Directus history prune (AFC-1222 F6).
#
# Deletes Directus system history older than the edge-log window so the
# observability trail does not become a second, ungoverned retention store:
#   directus_activity  (who changed what, with payload diffs)
#   directus_revisions (version snapshots, may embed child PII from
#                       event_registrations edits; keyed to activity, so they
#                       prune with their activity row)
#
# SAFETY POSTURE
#   Dry-run by default: with no flags this prints the row counts it WOULD
#   delete and changes nothing. Deletion needs BOTH:
#     --apply                 perform the deletes (default: report only)
#     PRUNE_CONFIRM=prune     second key, so a bare --apply in a pasted
#                             command still does nothing
#   The window is a CLI argument (default 30, must be >= 7): no duration is
#   hard-coded here, and the 30-day figure is the F6 acceptance (edge-log
#   parity), not a retention-policy period — retention periods live in
#   retention_policies, never in this file (scripts/retention-literal-gate.sh).
#
# CONNECTION. Reads POSTGRES_* from the environment, same shape as the
# db-backup entrypoint. Never takes credentials on the command line.
# Runbook row: docs/planning/infra-spec.md §6, next to the backup table.
# ---------------------------------------------------------------------------
set -uo pipefail

WINDOW_DAYS=30
APPLY=0

for arg in "$@"; do
  case "$arg" in
    --apply) APPLY=1 ;;
    --window-days=*) WINDOW_DAYS="${arg#--window-days=}" ;;
    -h|--help)
      echo "Usage: $(basename "$0") [--apply] [--window-days=N]"
      echo "  Default is a dry run reporting deletable rows. --apply deletes."
      exit 0
      ;;
    *)
      echo "Unknown argument: $arg" >&2
      exit 2
      ;;
  esac
done

case "$WINDOW_DAYS" in
  ''|*[!0-9]*)
    echo "REFUSING: --window-days must be a whole number of days." >&2
    exit 2
    ;;
esac

if [ "$WINDOW_DAYS" -lt 7 ]; then
  echo "REFUSING: window $WINDOW_DAYS days is below the 7-day floor." >&2
  exit 2
fi

for var in POSTGRES_DB POSTGRES_USER PGPASSWORD; do
  if [ -z "${!var:-}" ]; then
    echo "REFUSING: $var is not set (values live in the host .env, never here)." >&2
    exit 2
  fi
done

HOST="${POSTGRES_HOST:-postgres}"
PORT="${POSTGRES_PORT:-5432}"
export PGHOST="$HOST" PGPORT="$PORT" PGDATABASE="$POSTGRES_DB" PGUSER="$POSTGRES_USER"

psql_cmd() {
  psql -v ON_ERROR_STOP=1 -tAX -c "$1"
}

for table in directus_activity directus_revisions; do
  if ! psql_cmd "SELECT to_regclass('public.$table')" | grep -q "$table"; then
    echo "SKIP: public.$table not present (Directus never booted or table renamed)."
    continue
  fi
done

echo "Window: rows older than $WINDOW_DAYS days."
ACTIVITY_COUNT="$(psql_cmd "SELECT count(*) FROM directus_activity WHERE timestamp < now() - make_interval(days => $WINDOW_DAYS)")"
REVISIONS_COUNT="$(psql_cmd "SELECT count(*) FROM directus_revisions WHERE activity IN (SELECT id FROM directus_activity WHERE timestamp < now() - make_interval(days => $WINDOW_DAYS))")"
echo "directus_activity eligible:  $ACTIVITY_COUNT"
echo "directus_revisions eligible: $REVISIONS_COUNT"

if [ "$APPLY" -ne 1 ]; then
  echo "DRY RUN: nothing deleted. Re-run with --apply and PRUNE_CONFIRM=prune to delete."
  exit 0
fi

if [ "${PRUNE_CONFIRM:-}" != "prune" ]; then
  echo "REFUSING: --apply without PRUNE_CONFIRM=prune changes nothing by design." >&2
  exit 2
fi

psql -v ON_ERROR_STOP=1 -c "DELETE FROM directus_revisions WHERE activity IN (SELECT id FROM directus_activity WHERE timestamp < now() - make_interval(days => $WINDOW_DAYS))"
psql -v ON_ERROR_STOP=1 -c "DELETE FROM directus_activity WHERE timestamp < now() - make_interval(days => $WINDOW_DAYS)"
echo "APPLIED: history older than $WINDOW_DAYS days deleted."
