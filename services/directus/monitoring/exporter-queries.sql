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

-- metric: ndpa_breach_clock_origin_missing
-- Must stay at 0. Alerting on > 0 catches a migration that was not applied or a
-- row that arrived from outside it.
SELECT count(*)::bigint AS value
FROM incidents
WHERE awareness_at IS NULL;

-- metric: ndpa_breach_provenance_missing
-- Must stay at 0. NDPC asks whether a recorded clock origin is real or inferred;
-- a NULL provenance cannot answer that question.
SELECT count(*)::bigint AS value
FROM incidents
WHERE awareness_at IS NULL OR awareness_at_source IS NULL;

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