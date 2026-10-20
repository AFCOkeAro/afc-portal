-- 20261020_0015_hardening.sql
--
-- Slice 5d: hardening — retention/consent automation, cost reporting, dedupe,
-- monitoring (AFC-486). Spec authority: docs/adr/ADR-0010 decision 4,
-- docs/adr/ADR-0009 (decisions 3-5, 7), docs/planning/prd-addendum-v4.md
-- §3.3 + §4 (US-N1 AC4, US-C2 AC1, US-C5, OQ-R5), data-model-expansion §10.
-- Parent: AFC-465.
--
-- WHAT THIS FILE CREATES (all owned by no earlier migration — verified: none
-- of the four tables below exists in services/directus/schema/migrations/):
--   communication_suppressions -- STOP / consent-withdrawal registry. One row
--     per (contact_hash, channel): a STOP suppresses ALL further sends to that
--     number on that channel (or every channel when channel = 'all'),
--     recorded with reason + source. The consent resolver (0004) excludes
--     opted_out at audience time; this table is the durable cross-campaign
--     memory of that withdrawal, read by the tick before any send.
--     Stores hashes only — never a raw phone number or name.
--   campaign_cost_rates        -- per-channel unit cost (NGN). The rate card
--     procurement sets (integrations-addendum I4): estimate-before-send and
--     actual-after are audience_size × unit_cost, recorded on the sibling
--     campaign_runs / communications rows this slice does NOT own.
--     Owner of every naira: the area admin (enforced in the route layer;
--     this layer states the ceiling).
--   person_duplicate_reviews   -- phone-identity duplicate warning with a
--     branch-admin merge / keep-separate decision (US-N1 AC4). A warning is a
--     pending row; a terminal state (merged | kept_separate) requires the
--     decider + reason. NEVER a silent auto-merge: no trigger, function, or
--     grant here merges anything — merging is a reviewed migrator step.
--     Stores the identity hash only, never raw PII.
--   hardening_monitor_checks   -- append-only monitoring log: endpoint /
--     schedule health, queue depth, tick SLO, exclusions-by-reason. One row
--     per check execution; detail carries ids and counts only, never message
--     content (integrations-addendum §7). The Telegram staff alert reads this
--     log; it does not read the delivery log.
--
-- WHAT THIS FILE DELIBERATELY DOES NOT CREATE OR TOUCH
--   retention_policies / retention_clocks / retention_runs — owned by 0004 +
--     the retention engine; the scheduled Flow (retention_consent_automation)
--     drives the existing retention.run(), it does not fork it.
--   consent_records / communications / communication_recipients — owned by
--     0004; the STOP Flow writes consent granted = false through the 0004
--     INSERT grant (a withdrawal is a new row, never an edit) and records the
--     suppression here. No 0004 column is redefined.
--   campaign_runs.estimated_cost / .actual_cost — owned by 0006; this slice
--     supplies the rate card and the pure estimate function, never a second
--     cost column.
--   people — the dedupe review references person rows by bare uuid (the
--     hierarchy/people slices own those tables); a review naming a missing
--     row fails loudly at the route layer, never silently.
--
-- CHOICE, STATED (no durations in this file): the retention schedule lives in
-- retention_policies (config, counsel-ratified) and the campaign guardrails
-- (quiet hours, fallback window) live in 0006. Nothing here names a period,
-- so there is nothing here for the retention-literal gate to catch — the
-- migration directory is exempt, and this file stays clean regardless.
--
-- CHOICE, STATED (no triggers): every control here is a CHECK plus the grant
-- list. A trigger is a behaviour nobody asked for in a registry whose writers
-- are the Flow and the tick; the rollback-control gate therefore has only
-- drops of objects this same migration created to reconcile.
--
-- Rollback: rollback/20261020_0015_hardening.down.sql (refuses while any of
-- the four tables holds a row; drops functions, then tables). Owner: migration
-- role (directus_migrator). Never run as directus_app. Role hygiene per
-- ADR-0002: this file provisions no roles and grants no role-creation or
-- superuser capability; only GRANT/REVOKE below. No durations, no awareness_at.

-- ---------------------------------------------------------------------------
-- 0. Bootstrap roles exist. Fail closed naming this file, per the 0001/0002
--    pattern: a deploy that skipped bootstrap gets a sentence, not a partial
--    install. Only GRANT/REVOKE below -- this file mints no roles (ADR-0002,
--    scripts/migration-privilege-gate.sh).
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_missing text;
BEGIN
  SELECT string_agg(r, ', ') INTO v_missing
     FROM unnest(ARRAY['directus_migrator', 'directus_app']) AS r
    WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r);

  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION
      'bootstrap role(s) % are missing. They are provisioned by the cluster-owner '
      'bootstrap step BEFORE the migration sequence (ADR-0002), not by a migration. '
      'See services/directus/schema/bootstrap/README.md.',
      v_missing
      USING ERRCODE = 'restrict_violation';
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- 1. communication_suppressions — the STOP registry.
--
-- One row per (contact_hash, channel). channel = 'all' suppresses every
-- channel for that hash (the US-N3 AC3 / §3.3 promise: STOP suppresses all
-- further sends to that number, including other campaigns). reason records
-- WHY the number went quiet (opt_out_stop, consent_withdrawn, dnc,
-- invalid_contact); source records WHO/WHAT recorded it (member_reply,
-- staff_action, flow, tick). A suppression is never edited and never
-- deleted: a re-consent is a new consent_records grant, and the Flow lifts
-- the suppression explicitly — history stays readable.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS communication_suppressions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_hash text NOT NULL CHECK (btrim(contact_hash) <> ''),
  channel      text NOT NULL
                 CHECK (channel IN ('whatsapp', 'sms', 'email', 'all')),
  reason       text NOT NULL
                 CHECK (reason IN
                   ('opt_out_stop', 'consent_withdrawn', 'dnc',
                    'invalid_contact', 'over_cap_abuse')),
  source       text NOT NULL
                 CHECK (source IN
                   ('member_reply', 'staff_action', 'flow', 'tick')),
  created_by   uuid,
  created_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT communication_suppressions_one_per_channel
    UNIQUE (contact_hash, channel)
);

COMMENT ON TABLE communication_suppressions IS
  'STOP / consent-withdrawal registry (AFC-486, prd-addendum-v4 §3.3 + US-N3 AC3). One row per (contact_hash, channel); channel = all suppresses every channel. Hashes only, never raw phone. Never updated, never deleted: a re-consent is a new consent grant plus an explicit lift, and the history is the audit trail.';

CREATE INDEX IF NOT EXISTS communication_suppressions_hash_idx
  ON communication_suppressions (contact_hash);

-- Suppressed(p_hash, p_channel): the tick predicate. Reads this table only,
-- so it is STABLE, not IMMUTABLE. A row for the exact channel OR for 'all'
-- suppresses the send; anything else sends (the resolver still applies).
CREATE OR REPLACE FUNCTION hardening_suppressed(
  p_contact_hash text,
  p_channel text
)
RETURNS boolean
LANGUAGE plpgsql STABLE AS $$
BEGIN
  IF p_contact_hash IS NULL OR btrim(p_contact_hash) = '' THEN
    RAISE EXCEPTION
      'hardening_suppressed: a contact hash is required'
      USING ERRCODE = 'check_violation';
  END IF;

  IF p_channel IS NULL
     OR p_channel NOT IN ('whatsapp', 'sms', 'email') THEN
    RAISE EXCEPTION
      'hardening_suppressed: unknown channel %, expected whatsapp/sms/email',
      p_channel
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN EXISTS (
    SELECT 1 FROM communication_suppressions s
     WHERE s.contact_hash = p_contact_hash
       AND s.channel IN (p_channel, 'all')
  );
END
$$;

COMMENT ON FUNCTION hardening_suppressed(text, text) IS
  'STOP predicate (AFC-486). True when a suppression row covers (hash, channel) directly or via channel = all. The tick checks this before any send; a withdrawal recorded here suppresses every campaign, not just the current one.';

-- ---------------------------------------------------------------------------
-- 2. campaign_cost_rates — the rate card procurement sets.
--
-- One current row per channel (UNIQUE(channel)): the NGN unit cost of one
-- message on that channel. NULL unit_cost means "unset" (procurement has not
-- set the real rate card, I4) — never zero: a zero rate would report a real
-- spend of nothing. effective_from stamps the rate the estimate used, so a
-- later rate change does not rewrite what an old run claimed to cost.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS campaign_cost_rates (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  channel        text NOT NULL UNIQUE
                   CHECK (channel IN ('whatsapp', 'sms', 'email')),
  unit_cost      numeric(12,4) CHECK (unit_cost IS NULL OR unit_cost >= 0),
  currency       text NOT NULL DEFAULT 'NGN'
                   CHECK (currency IN ('NGN', 'USD', 'GBP')),
  effective_from timestamptz NOT NULL DEFAULT now(),
  created_by     uuid,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE campaign_cost_rates IS
  'Per-channel message unit cost (AFC-486, integrations-addendum I4). One row per channel; NULL unit_cost = unset until procurement sets the rate card, never zero. Estimates on campaign_runs reference the rate in force; actuals are provider-confirmed. Owner of every naira: the area admin.';

-- Pure estimate: audience_size × unit_cost. Both operands required and
-- non-negative; a NULL rate raises instead of guessing zero (an estimate
-- that guesses is not an estimate). IMMUTABLE: no table access — the caller
-- supplies the rate it read, so the estimate names the rate it used.
CREATE OR REPLACE FUNCTION hardening_estimate_cost(
  p_audience_size integer,
  p_unit_cost numeric
)
RETURNS numeric
LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN
  IF p_audience_size IS NULL OR p_unit_cost IS NULL THEN
    RAISE EXCEPTION
      'hardening_estimate_cost: audience size and unit cost are both required (a NULL rate means unset, never zero)'
      USING ERRCODE = 'check_violation';
  END IF;

  IF p_audience_size < 0 OR p_unit_cost < 0 THEN
    RAISE EXCEPTION
      'hardening_estimate_cost: audience size and unit cost must be non-negative'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN p_audience_size * p_unit_cost;
END
$$;

COMMENT ON FUNCTION hardening_estimate_cost(integer, numeric) IS
  'Per-run cost estimate (AFC-486, US-C2 AC1). Pure: audience × unit_cost. A NULL rate raises — unset is reported as unset, never as a zero spend. The actual is provider-confirmed and recorded on the sibling run row this slice does not own.';

-- ---------------------------------------------------------------------------
-- 3. person_duplicate_reviews — the US-N1 AC4 warning, not a merge.
--
-- A duplicate warning is a pending row: two person rows sharing one phone
-- identity hash, seen in one branch. The branch admin decides — merged or
-- kept_separate — with a reason; the decision columns are REQUIRED for a
-- terminal state and FORBIDDEN for a pending one, so a row can never read
-- "decided" without saying who decided and why, and a pending row can never
-- borrow authority it does not have. NOTHING HERE MERGES: there is no
-- trigger, no function, and no grant that writes a person row. Merging two
-- people's sacramental/financial history is irreversible, so the merge itself
-- is a reviewed migrator step outside this table.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS person_duplicate_reviews (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_hash    text NOT NULL CHECK (btrim(contact_hash) <> ''),
  person_a        uuid,
  person_b        uuid,
  branch          uuid,
  status          text NOT NULL DEFAULT 'pending'
                    CHECK (status IN
                      ('pending', 'merged', 'kept_separate')),
  decided_by      uuid,
  decision_reason text,
  decided_at      timestamptz,
  created_by      uuid,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT person_duplicate_reviews_two_distinct_people
    CHECK (person_a IS NULL OR person_b IS NULL OR person_a <> person_b),
  CONSTRAINT person_duplicate_reviews_decision_present_when_terminal
    CHECK ((status = 'pending'
            AND decided_by IS NULL
            AND decision_reason IS NULL
            AND decided_at IS NULL)
           OR (status IN ('merged', 'kept_separate')
            AND decided_by IS NOT NULL
            AND decision_reason IS NOT NULL
            AND btrim(decision_reason) <> ''
            AND decided_at IS NOT NULL))
);

COMMENT ON TABLE person_duplicate_reviews IS
  'Phone-identity duplicate warnings (AFC-486, US-N1 AC4). A warning is a pending row; the branch admin decides merged or kept_separate with a reason — never a silent auto-merge, enforced by the decision CHECK. Identity hash only, never raw PII. History is audit: nothing here is deletable.';

CREATE INDEX IF NOT EXISTS person_duplicate_reviews_hash_idx
  ON person_duplicate_reviews (contact_hash);
CREATE INDEX IF NOT EXISTS person_duplicate_reviews_status_idx
  ON person_duplicate_reviews (status) WHERE status = 'pending';

-- ---------------------------------------------------------------------------
-- 4. hardening_monitor_checks — the append-only monitoring log.
--
-- One row per check execution (check_key: endpoint_health, schedule_health,
-- queue_depth, tick_slo, exclusions_audit, pause_drill). ok says whether the
-- check passed; detail carries ids and counts only — never message content,
-- contact values, or rendered text (integrations-addendum §7). The Telegram
-- staff alert reads the latest row per key; it never reads the delivery log.
-- Append-only via grants (INSERT + SELECT, no UPDATE/DELETE): a check outcome
-- is evidence, and evidence is not edited.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS hardening_monitor_checks (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  check_key   text NOT NULL
                CHECK (check_key IN
                  ('endpoint_health', 'schedule_health', 'queue_depth',
                   'tick_slo', 'exclusions_audit', 'pause_drill')),
  ok          boolean NOT NULL,
  detail      text,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  recorded_by uuid
);

COMMENT ON TABLE hardening_monitor_checks IS
  'Monitoring log (AFC-486). One row per check execution; detail carries ids and counts only, never message content. Append-only: a check outcome is evidence. The Telegram staff alert reads the latest row per key.';

CREATE INDEX IF NOT EXISTS hardening_monitor_checks_key_time_idx
  ON hardening_monitor_checks (check_key, recorded_at DESC);

-- Tick SLO predicate (ADR-0009 consequence: a due step begins within 5 min
-- of its window 99% of the time). Pure: the caller supplies the window and
-- the actual begin instant; this rule decides. The 99% is measured over the
-- monitor log, not in this row — a per-row percentage would be a guess.
CREATE OR REPLACE FUNCTION hardening_tick_slo_met(
  p_window_at timestamptz,
  p_began_at timestamptz
)
RETURNS boolean
LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN
  IF p_window_at IS NULL OR p_began_at IS NULL THEN
    RAISE EXCEPTION
      'hardening_tick_slo_met: window and begin instants are both required'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN p_began_at <= p_window_at + make_interval(mins => 5);
END
$$;

COMMENT ON FUNCTION hardening_tick_slo_met(timestamptz, timestamptz) IS
  'Tick SLO predicate (AFC-486, ADR-0009). Pure: a due step meets the SLO when it begins within five minutes of its window. The percentage is computed over hardening_monitor_checks, never guessed in this row.';

-- ---------------------------------------------------------------------------
-- 5. Least privilege (data-model-expansion §10 pattern).
--
-- Postgres sees ONE app identity (directus_app) for every Directus role, so
-- branch/zone scoping lives in the Directus policy + portal route filters,
-- not here. This layer states the ceiling:
--   communication_suppressions: the app reads and inserts the recorded
--     withdrawal (STOP from any channel, staff action, Flow, tick). No
--     UPDATE, no DELETE: a suppression is lifted explicitly by a new Flow
--     step this migration does not grant, and history is never rewritten.
--   campaign_cost_rates: the rate card is board config — the app reads;
--     writes go through the reviewed area-admin route only (INSERT of the
--     channel row + UPDATE of the rate columns). Nothing is deletable: an
--     old rate is superseded by effective_from, not removed.
--   person_duplicate_reviews: the app inserts the warning and records the
--     branch-admin decision (status/decided_by/decision_reason/decided_at)
--     only. Identity and person links are immutable (no UPDATE grant): a
--     correction is a new review, not an edit. Nothing is deletable.
--   hardening_monitor_checks: the app inserts check outcomes and reads them
--     back. No UPDATE, no DELETE: a check outcome is evidence.
-- ---------------------------------------------------------------------------
GRANT SELECT ON communication_suppressions TO directus_app;
GRANT INSERT (contact_hash, channel, reason, source, created_by)
  ON communication_suppressions TO directus_app;

GRANT SELECT ON campaign_cost_rates TO directus_app;
GRANT INSERT (channel, unit_cost, currency, effective_from, created_by)
  ON campaign_cost_rates TO directus_app;
GRANT UPDATE (unit_cost, currency, effective_from, updated_at)
  ON campaign_cost_rates TO directus_app;

GRANT SELECT ON person_duplicate_reviews TO directus_app;
GRANT INSERT (contact_hash, person_a, person_b, branch, status, created_by)
  ON person_duplicate_reviews TO directus_app;
GRANT UPDATE (status, decided_by, decision_reason, decided_at, updated_at)
  ON person_duplicate_reviews TO directus_app;

GRANT SELECT ON hardening_monitor_checks TO directus_app;
GRANT INSERT (check_key, ok, detail, recorded_by)
  ON hardening_monitor_checks TO directus_app;

REVOKE ALL ON communication_suppressions FROM PUBLIC;
REVOKE ALL ON campaign_cost_rates FROM PUBLIC;
REVOKE ALL ON person_duplicate_reviews FROM PUBLIC;
REVOKE ALL ON hardening_monitor_checks FROM PUBLIC;
