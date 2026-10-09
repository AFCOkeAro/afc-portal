-- services/directus/monitoring/exporter-queries.sql
--
-- The queries behind the alert rules in ndpa_breach_clock.rules.yml.
--
-- Read by a postgres_exporter custom-query collector (repo-plan §infra-spec), one
-- metric per query, one row per incident. Nothing is aggregated here on purpose:
-- the alerts need per-incident labels so a responder can be told which breach is
-- burning down, and an aggregate would force the runbook to go and look.
--
-- Every number is derived from awareness_at. Nothing in this file reads
-- detected_at for a deadline, because detected_at is "when engineering found
-- it" and staff can tell the board before engineering notices. A deadline
-- computed from detected_at under-reports the obligation, which is the one
-- direction of error the NDPA does not forgive.
--
-- The exporter runs as a read-only monitoring role. It needs SELECT on
-- incidents_breach_clock only -- never on incidents directly, so that adding a
-- column to the register cannot leak member data into the metrics pipeline.

-- metric: ndpa_breach_clock_remaining_hours
-- gauges: ref, severity, status, awareness_at, detected_at, awareness_at_source, notification_due_at
SELECT
  remaining_hours                        AS value,
  ref                                    AS ref,
  severity                               AS severity,
  status                                 AS status,
  awareness_at::text                     AS awareness_at,
  detected_at::text                      AS detected_at,
  awareness_at_source                    AS awareness_at_source,
  notification_due_at::text              AS notification_due_at
FROM incidents_breach_clock;

-- metric: ndpa_breach_clock_deadline_unix_seconds
-- Useful for range queries and for a dashboard that computes "overdue by".
SELECT
  EXTRACT(EPOCH FROM notification_due_at) AS value,
  ref                                     AS ref,
  severity                                AS severity
FROM incidents_breach_clock;

-- metric: ndpa_schema_awareness_at_present
-- Reachable readiness probe (AFC-255 Finding 2). 1 when both clock columns
-- exist on incidents, 0 otherwise. Uses to_regclass so it never errors -- on
-- a database where 0002 never applied, or where the table itself is absent,
-- this emits 0 instead of erroring, which is exactly what the alert below
-- needs: an absent series never fires, a 0 does.
-- Replaces ndpa_breach_clock_origin_missing / ndpa_breach_provenance_missing,
-- which queried `FROM incidents WHERE awareness_at IS NULL` -- a condition
-- the NOT NULL constraint plus the BEFORE INSERT guard make unreachable, and
-- which errors (emitting nothing) when the migration is missing.
SELECT (
  CASE WHEN to_regclass('public.incidents') IS NULL THEN 0
       WHEN (SELECT count(*) FROM pg_attribute
              WHERE attrelid = to_regclass('public.incidents')
                AND attname IN ('awareness_at', 'awareness_at_source')) = 2 THEN 1
       ELSE 0 END
)::bigint AS value;

-- metric: ndpa_breach_open_count
-- Not part of the deadline, but the first thing a responder wants on the
-- dashboard: how many clocks are running at all.
SELECT count(*)::bigint AS value
FROM incidents
WHERE status NOT IN ('reported', 'closed');

-- metric: ndpa_breach_overdue_count
SELECT count(*)::bigint AS value
FROM incidents_breach_clock
WHERE remaining_hours <= 0;