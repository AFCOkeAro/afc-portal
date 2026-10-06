-- 20261006_0004_retention.sql
--
-- Retention and legal-hold substrate. AFC-167 / ADR-159-2 D1-D6.
--
-- WHAT IS AND IS NOT IN THIS FILE
--   Tables, constraints and triggers only. NO DURATION APPEARS HERE. The
--   engine that reads them lives in services/directus/schema/engine/, which
--   the retention-literal gate scans and this directory does not exempt.
--
--   This file seeds NOTHING. There is no INSERT of a policy row. The schedule
--   is a legal commitment ratified by the board and being confirmed by counsel
--   (AFC-159, AFC-162), and until that answer lands the correct state of this
--   table is empty. A retention system with a plausible-looking default period
--   is worse than one with none: the default would delete data nobody decided
--   to delete. Ship dark (D6).
--
--   Anchor resolution and erasure targets are configuration too, in
--   retention_anchor_sources and retention_class_sources. "Which column means
--   case_closed_at" is a fact about the data model and it changes when the data
--   model changes; it does not belong in a function body where a code change
--   would be the only way to correct it.
--
-- Rollback: rollback/20261006_0004_retention.down.sql (DROP TABLE, additive).
-- Safe because the engine holds no state a person needs.

-- ---------------------------------------------------------------------------
-- 0. people -- MINIMAL retention anchor, NOT the v4 data model.
--
-- AFC-167 section 2 keys every clock on person_id and CTO review F2 requires a
-- person-scoped legal hold to resolve to "a live people row". Both need the
-- table to exist. The full data-model people table has ~25 columns covering
-- names, contacts, household and departmental links; none of them are needed
-- to answer "how old is this person" and "is this person still live".
--
-- MERGE CONTRACT, so this cannot become a second competing people table: the
-- data-model migration that lands later must ALTER TABLE ADD COLUMN, never
-- CREATE TABLE. If it creates the table instead, it silently forks the identity
-- the retention engine resolves holds and age anchors against. Asserted in
-- tests/db/63_retention_privileges.sql.
--
-- Only retention-required columns are declared here. Anything else this table
-- ends up carrying is scope creep.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS people (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  date_of_birth date,
  -- 'active' | 'archived'. An archived person is still a data subject; the
  -- flag means "no longer an operational record", not "no longer exists".
  status        text NOT NULL DEFAULT 'active'
                  CHECK (status IN ('active', 'archived')),
  created_at    timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE people IS
  'Retention identity anchor: the minimum a retention clock and a legal hold need to resolve against. NOT the full v4 people record -- later fields arrive as ALTER TABLE ADD COLUMN.';

CREATE INDEX IF NOT EXISTS people_date_of_birth_idx ON people (date_of_birth)
  WHERE date_of_birth IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 1. Anchor source map. anchor_key -> the column that holds that event.
--
-- Example rows a deployment would add (NOT seeded here):
--   case_closed_at            safeguarding_concerns  case_closed_at
--   date_of_birth             people                  date_of_birth
--
-- The engine resolves these with dynamic SQL, so a rule that says "the clock
-- starts when the case is closed" is satisfied by a row, not by code. That is
-- D1 applied to anchors as well as to durations.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS retention_anchor_sources (
  anchor_key text PRIMARY KEY,
  table_name text NOT NULL,
  column_name text NOT NULL,
  -- The column linking an event row back to its person. Directus m2o links are
  -- named per collection and data-model-v4 is explicit that `person` is the
  -- canonical link for people, so the physical name is a data-model fact that
  -- will differ between collections. Hard-coding it in the engine would be the
  -- same mistake as hard-coding a period: a link rename would become a code
  -- change and a deploy instead of a row update.
  person_column text NOT NULL DEFAULT 'person_id',
  -- When true the anchor is the person's own attribute (looked up on the people
  -- row by id) rather than an event row looked up by person. Keeps
  -- date_of_birth in the same shape as case_closed_at without special-casing it
  -- in code.
  is_person_attribute boolean NOT NULL DEFAULT false
);

COMMENT ON TABLE retention_anchor_sources IS
  'Which column supplies each retention anchor, and how that row links to a person. Config, not code: re-pointing an anchor is a row update.';

-- ---------------------------------------------------------------------------
-- 2. Erasure target map. retention_class -> the tables whose rows are erased
--    when a clock of that class comes due, and the column holding person_id.
--
-- Shipped empty. This is the table that makes the engine's DELETE
-- config-driven rather than a hard-coded list of collections, and the reason
-- "delete the person" is not merely discouraged but unrepresentable.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS retention_class_sources (
  retention_class text NOT NULL,
  table_name      text NOT NULL,
  person_column   text NOT NULL DEFAULT 'person_id',
  PRIMARY KEY (retention_class, table_name)
);

COMMENT ON TABLE retention_class_sources IS
  'Per-category erasure targets. Empty by design: which tables hold which category is a data-model fact ratified with the policy, not a CTO default.';

-- ---------------------------------------------------------------------------
-- 3. retention_policies -- the single auditable place the schedule lives.
--
-- CTO review F1: UNIQUE(rule_key) alone makes version/supersedes_id unworkable
-- and destroys the audit trail. "What rule was in force when we deleted this?"
-- has to be answerable, so the constraint is UNIQUE(rule_key, version) plus a
-- partial unique index pinning exactly one is_active row per rule_key.
-- Counsel's answer becomes version + 1 plus supersedes_id. Nothing is
-- rewritten and no historical row is touched.
--
-- CTO review F3: both durations nullable AND operator nullable is an undefined
-- due date. Fail closed at state='indeterminate', never coerce a NULL duration
-- to zero and never default a missing operator.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS retention_policies (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_key            text NOT NULL,
  retention_class     text NOT NULL,
  version             integer NOT NULL CHECK (version >= 1),
  effective_from      timestamptz NOT NULL,
  anchor_a            text NOT NULL REFERENCES retention_anchor_sources(anchor_key),
  anchor_b            text          REFERENCES retention_anchor_sources(anchor_key),
  floor_years         integer CHECK (floor_years IS NULL OR floor_years >= 0),
  age_threshold_years integer CHECK (age_threshold_years IS NULL OR age_threshold_years >= 0),
  operator            text CHECK (operator IN ('whichever_later', 'whichever_earlier')),
  -- D5. Ordered stage names, last entry terminal. Reached in order; a clock
  -- whose stage is not the terminal one is not a candidate.
  ladder_stages       jsonb,
  -- D6. Ships dark. Live erasure needs this true, which is a separately
  -- audited config change, and not before go-live approval plus the first
    -- production compliance audit.
  delete_enabled      boolean NOT NULL DEFAULT false,
  is_active           boolean NOT NULL DEFAULT true,
  supersedes_id       uuid REFERENCES retention_policies(id),
  created_at          timestamptz NOT NULL DEFAULT now(),
  created_by          uuid,
  note                text,
  CONSTRAINT retention_policies_rule_key_version_key UNIQUE (rule_key, version),
  -- F3: at least one operand must exist, and the operator must be named.
  -- Without this a policy row with everything NULL is storable, computes no
  -- due date, and fails closed forever -- a rule that can never fire, silently.
  CONSTRAINT retention_policies_operand_present
    CHECK (floor_years IS NOT NULL OR age_threshold_years IS NOT NULL),
  CONSTRAINT retention_policies_operator_present
    CHECK (operator IS NOT NULL),
  -- An anchor_b with no age threshold is a config error, not a valid shape:
  -- it reads as "and until the child turns N" with no N.
  CONSTRAINT retention_policies_anchor_b_needs_threshold
    CHECK (anchor_b IS NULL OR age_threshold_years IS NOT NULL)
);

-- Two different active rows for one rule_key is the one state that makes
-- "which rule was in force" unanswerable, so it is a write-time error.
--
-- Partial, NOT a table-level UNIQUE(rule_key). A table-level unique here is
-- the bug CTO review F1 was raised against: it makes version + supersedes_id
-- unrepresentable, so the only way to change a rule is to destroy the record
-- of the previous one, and "what rule was in force when we deleted this?"
-- becomes permanently unanswerable.
CREATE UNIQUE INDEX IF NOT EXISTS retention_policies_one_active_per_rule
  ON retention_policies (rule_key) WHERE is_active;

COMMENT ON TABLE retention_policies IS
  'The retention schedule. Config only: the engine contains no period. Supersede with version+1, never UPDATE in place.';

-- ---------------------------------------------------------------------------
-- 4. retention_clocks -- the computed due date per (person, class).
--
-- Per CATEGORY, never per person (D3). A person may hold several classes and
-- only one people row; each class is independently erasable and independently
-- held. A "delete the person" job is therefore both wrong and destructive, and
-- UNIQUE(person_id, retention_class) makes the per-category shape structural
-- rather than a convention.
--
-- policy_id / policy_version are denormalised so the manifest can name the
-- rule that was in force at the moment of erasure, which is the question the
-- NDPC or a data subject will actually ask.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS retention_clocks (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  person_id        uuid NOT NULL REFERENCES people(id),
  retention_class  text NOT NULL,
  policy_id        uuid NOT NULL REFERENCES retention_policies(id),
  policy_version   integer NOT NULL,
  anchor_a_value   timestamptz,
  anchor_b_value   timestamptz,
  due_at           timestamptz,
  -- 'indeterminate' is the fail-closed state: an anchor has not happened yet,
  -- or the policy is unconfigured. It is NEVER a delete candidate. This is the
  -- single most dangerous bug available in this system.
  state            text NOT NULL
                     CHECK (state IN ('live', 'due', 'pseudonymised', 'deleted', 'held', 'indeterminate')),
  ladder_stage     text NOT NULL DEFAULT 'identified',
  computed_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (person_id, retention_class)
);

CREATE INDEX IF NOT EXISTS retention_clocks_due_idx ON retention_clocks (due_at)
  WHERE state IN ('live', 'indeterminate');
CREATE INDEX IF NOT EXISTS retention_clocks_state_idx ON retention_clocks (state);

COMMENT ON TABLE retention_clocks IS
  'Computed retention due date per (person, class). state=indeterminate means fail closed, never deletable.';

-- ---------------------------------------------------------------------------
-- 4b. Only the engine may move a clock's state.
--
-- directus_app holds SELECT only, so no grant list exposes this today. But a
-- grant list can be widened by accident, and a session that can UPDATE
-- retention_clocks can set state='deleted' without erasing a single row -- a
-- false record of erasure, written through the control that exists to make
-- erasure provable. Same reasoning as incidents.awareness_at: permissions are a
-- layer, a trigger is the control.
--
-- The test is current_user, because retention.run is SECURITY DEFINER: inside
-- it, current_user is the engine's owner role, which is NOLOGIN and is assumed
-- only by the migration and job paths. Any session reaching the table by any
-- other route is refused.
--
-- Documented residual, identical to the one AFC-166 asserts for incidents: the
-- table owner can disable this trigger. It is recorded rather than assumed, and
-- it is why the owner is a non-authenticating role and why the manifest records
-- the actor.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION retention_clocks_guard_state() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.state IS DISTINCT FROM OLD.state
     AND current_user <> 'directus_migrator' THEN
    RAISE EXCEPTION
      'retention_clocks.state is written only by the retention engine. Marking a clock deleted is a record of erasure, and erasure happens in retention.run().'
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS retention_clocks_state_is_engine_owned ON retention_clocks;
CREATE TRIGGER retention_clocks_state_is_engine_owned
  BEFORE UPDATE ON retention_clocks
  FOR EACH ROW EXECUTE FUNCTION retention_clocks_guard_state();

-- 4c. Same reasoning for delete_enabled.
--
-- AFC-167 section 6: live erasure needs this flag, and flipping it is a
-- separately audited config change. If any role with UPDATE can flip it, that
-- is not an audited change, it is a grant. Enabling it stays a migration-time
-- or operator action under the owner role, reviewed, and recorded in the
-- retention_policies history by supersession.
CREATE OR REPLACE FUNCTION retention_policies_guard_delete_enabled() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.delete_enabled IS DISTINCT FROM OLD.delete_enabled
     AND current_user <> 'directus_migrator' THEN
    RAISE EXCEPTION
      'retention_policies.delete_enabled is changed only under the owner role, because enabling live erasure is a separately audited decision (AFC-167 section 6).'
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS retention_policies_delete_enabled_is_audited ON retention_policies;
CREATE TRIGGER retention_policies_delete_enabled_is_audited
  BEFORE UPDATE ON retention_policies
  FOR EACH ROW EXECUTE FUNCTION retention_policies_guard_delete_enabled();

-- ---------------------------------------------------------------------------
-- 5. legal_holds -- D4. Outranks every retention rule without exception.
--
-- CTO review F2: polymorphic text scope_id has no referential integrity, so a
-- hold with a mistyped id would be stored, would display as active, and would
-- block nothing. The trigger below resolves the scope BEFORE INSERT and
-- refuses to store an unresolvable hold. Fail closed at WRITE time, because a
-- hold that silently does not hold is worse than no hold at all: it produces
-- exactly the false assurance this control exists to prevent.
--
-- Released rows are NEVER deleted. A release is a historical fact about a
-- legal decision, and it is part of the audit trail that says why an erasure
-- was permitted on the day it happened.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS legal_holds (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scope_type    text NOT NULL CHECK (scope_type IN ('person', 'retention_class', 'collection')),
  scope_id      text NOT NULL,
  reason        text NOT NULL,
  placed_by     uuid NOT NULL,
  placed_at     timestamptz NOT NULL DEFAULT now(),
  released_by   uuid,
  released_at   timestamptz,
  CONSTRAINT legal_holds_released_pair CHECK (
    (released_by IS NULL     AND released_at IS NULL)
    OR (released_by IS NOT NULL AND released_at IS NOT NULL)
  ),
-- A release cannot be back-dated before the hold it releases.
  CONSTRAINT legal_holds_release_not_backdated
    CHECK (released_at IS NULL OR released_at >= placed_at)
);

CREATE INDEX IF NOT EXISTS legal_holds_active_person_idx ON legal_holds (scope_id)
  WHERE released_at IS NULL;
CREATE INDEX IF NOT EXISTS legal_holds_active_class_idx ON legal_holds (scope_type, scope_id)
  WHERE released_at IS NULL;

COMMENT ON TABLE legal_holds IS
  'Legal hold. Outranks every retention rule (D4). Released rows are historical fact and are never deleted.';

-- F2: the scope must resolve at write time.
CREATE OR REPLACE FUNCTION legal_holds_assert_scope_exists() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_ok boolean := false;
BEGIN
  IF NEW.scope_type = 'person' THEN
    -- A person-scoped hold only resolves against a live person row.
    SELECT true INTO v_ok FROM people p
     WHERE p.id::text = NEW.scope_id AND p.status = 'active';
  ELSIF NEW.scope_type = 'retention_class' THEN
    SELECT true INTO v_ok FROM retention_policies rp
     WHERE rp.retention_class = NEW.scope_id;
  ELSIF NEW.scope_type = 'collection' THEN
    -- A collection-scoped hold resolves against a known erasure target. It is
    -- deliberately not resolved against pg_class: a hold naming a table that
    -- does not exist blocks nothing and reads as active.
    SELECT true INTO v_ok FROM retention_class_sources rcs
     WHERE rcs.table_name = NEW.scope_id;
  ELSE
    RAISE EXCEPTION 'legal_holds.scope_type has a value outside the enum: %', NEW.scope_type
      USING ERRCODE = 'restrict_violation';
  END IF;

  IF NOT COALESCE(v_ok, false) THEN
    RAISE EXCEPTION
      'legal_holds scope did not resolve: %=%. A hold that does not resolve blocks nothing and reads as active, so it is refused at write time.'
      , NEW.scope_type, NEW.scope_id
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END $$;

COMMENT ON FUNCTION legal_holds_assert_scope_exists() IS
  'CTO review F2. Refuses a legal hold whose scope does not resolve. Fail closed at write time.';

-- A new hold is never created already released. A pre-released row is a hold
-- that displays as a legal decision that was placed and lifted, and blocks
-- nothing -- the F2 failure mode arriving through the INSERT door instead of a
-- typo'd id. The release path is retention.release_hold(), which stamps both
-- fields from the database.
CREATE OR REPLACE FUNCTION legal_holds_forbid_pre_release() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.released_by IS NOT NULL OR NEW.released_at IS NOT NULL THEN
    RAISE EXCEPTION
      'a legal hold is created active and released later, through retention.release_hold(). A hold inserted already released never held anything.'
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS legal_holds_no_pre_release ON legal_holds;
CREATE TRIGGER legal_holds_no_pre_release
  BEFORE INSERT ON legal_holds
  FOR EACH ROW EXECUTE FUNCTION legal_holds_forbid_pre_release();

-- A released hold is a historical fact. Deleting it would erase the record of
-- a legal decision.
CREATE OR REPLACE FUNCTION legal_holds_forbid_delete() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION
    'legal_holds rows are never deleted. A release is recorded by setting released_by/released_at, which is itself the audit trail.'
    USING ERRCODE = 'restrict_violation';
END $$;

-- A hold cannot be quietly re-armed or re-scoped after the fact. Placed fields
-- are immutable; release is one-way.
CREATE OR REPLACE FUNCTION legal_holds_guard_placed_fields() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.scope_type IS DISTINCT FROM OLD.scope_type
     OR NEW.scope_id   IS DISTINCT FROM OLD.scope_id
     OR NEW.reason     IS DISTINCT FROM OLD.reason
     OR NEW.placed_by  IS DISTINCT FROM OLD.placed_by
     OR NEW.placed_at  IS DISTINCT FROM OLD.placed_at
     OR NEW.id         IS DISTINCT FROM OLD.id THEN
    RAISE EXCEPTION
      'legal_holds placed fields are immutable. Scope, reason, placer and placement time are the evidence that the hold existed.'
      USING ERRCODE = 'restrict_violation';
  END IF;
  IF OLD.released_at IS NOT NULL
     AND (NEW.released_by IS DISTINCT FROM OLD.released_by
          OR NEW.released_at IS DISTINCT FROM OLD.released_at) THEN
    RAISE EXCEPTION
      'legal_holds release is terminal. A released hold cannot be re-armed or back-dated.'
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS legal_holds_scope_exists ON legal_holds;
CREATE TRIGGER legal_holds_scope_exists
  BEFORE INSERT OR UPDATE ON legal_holds
  FOR EACH ROW EXECUTE FUNCTION legal_holds_assert_scope_exists();

DROP TRIGGER IF EXISTS legal_holds_immutable ON legal_holds;
CREATE TRIGGER legal_holds_immutable
  BEFORE UPDATE ON legal_holds
  FOR EACH ROW EXECUTE FUNCTION legal_holds_guard_placed_fields();

DROP TRIGGER IF EXISTS legal_holds_no_delete ON legal_holds;
CREATE TRIGGER legal_holds_no_delete
  BEFORE DELETE ON legal_holds
  FOR EACH ROW EXECUTE FUNCTION legal_holds_forbid_delete();

-- ---------------------------------------------------------------------------
-- 6. retention_runs -- D6. One append-only manifest per run.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS retention_runs (
  run_id        uuid PRIMARY KEY,
  mode          text NOT NULL CHECK (mode IN ('dry_run', 'live')),
  started_at    timestamptz NOT NULL DEFAULT now(),
  finished_at   timestamptz,
  status        text NOT NULL CHECK (status IN ('running', 'succeeded', 'failed')),
  actor         text NOT NULL,
  lock_token    text,
  counts        jsonb,
  manifest_path text,
  error         text
);

COMMENT ON TABLE retention_runs IS
  'Per-run retention manifest header. Append-only once finished: a run row is the evidence that erasure happened, when, and under which rule version.';

-- ---------------------------------------------------------------------------
-- 7. retention_run_items -- one row per examined clock, with a reason for
--    every skip.
--
-- CTO review F8: 'past_due' was removed. Being past due is the reason to ACT;
-- selection is already carried by action IN ('would_delete','deleted'). An
-- ambiguous reason code in a compliance manifest is a defect, not a style
-- issue. The remaining set is complete and non-overlapping.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS retention_run_items (
  run_id          uuid NOT NULL REFERENCES retention_runs(run_id),
  person_id       uuid REFERENCES people(id),
  retention_class text NOT NULL,
  policy_version  integer,
  due_at          timestamptz,
  action          text NOT NULL
                    CHECK (action IN ('would_delete', 'deleted', 'would_pseudonymise',
                                      'pseudonymised', 'skipped')),
  skip_reason     text CHECK (skip_reason IN ('held', 'ladder_stage_not_reached',
                                              'already_deleted', 'policy_delete_disabled',
                                              'indeterminate_anchor'))
);

CREATE INDEX IF NOT EXISTS retention_run_items_run_idx ON retention_run_items (run_id);
CREATE INDEX IF NOT EXISTS retention_run_items_action_idx ON retention_run_items (run_id, action);

-- The manifest is evidence. It is written once and never rewritten.
CREATE OR REPLACE FUNCTION retention_runs_forbid_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'retention_runs rows are never deleted. The manifest is the evidence that erasure was considered.'
      USING ERRCODE = 'restrict_violation';
  END IF;
  IF OLD.finished_at IS NOT NULL AND NEW IS DISTINCT FROM OLD THEN
    RAISE EXCEPTION 'retention_runs rows are immutable once finished. A completed run is the compliance record.'
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS retention_runs_append_only ON retention_runs;
CREATE TRIGGER retention_runs_append_only
  BEFORE UPDATE OR DELETE ON retention_runs
  FOR EACH ROW EXECUTE FUNCTION retention_runs_forbid_mutation();

CREATE OR REPLACE FUNCTION retention_run_items_forbid_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION
    'retention_run_items are append-only. A run item is the record of what was decided for one clock.'
    USING ERRCODE = 'restrict_violation';
END $$;

DROP TRIGGER IF EXISTS retention_run_items_append_only ON retention_run_items;
CREATE TRIGGER retention_run_items_append_only
  BEFORE UPDATE OR DELETE ON retention_run_items
  FOR EACH ROW EXECUTE FUNCTION retention_run_items_forbid_mutation();

-- ---------------------------------------------------------------------------
-- 8. Least privilege (security lens, default deny).
--
--   directus_migrator  owns everything; runs migrations and the engine install.
--                      NOLOGIN.
--   retention_worker   the ONLY identity that may execute an erasure. Not the
--                      app role, and it holds no DELETE grant of its own -- it
--                      reaches erasure only through retention.run(), which
--                      re-checks the legal hold at the moment of erasure
--                      rather than trusting the selection that ran earlier.
--   directus_app       reads the schedule, places and releases holds through
--                      functions. Holds no UPDATE on legal_holds and no DELETE
--                      anywhere, so no Directus role and no Studio operator can
--                      erase a retention-covered record.
--
-- retention_worker is a BOOTSTRAP role, created by the instance bootstrap
-- alongside directus_migrator and directus_app -- not by this file, because a
-- migration runs as directus_migrator and that role does not hold CREATEROLE.
-- Failing loudly here is the point: a deploy that skips the bootstrap gets a
-- clear message, not an engine that exists and cannot be run by anyone.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'retention_worker') THEN
    RAISE EXCEPTION
      'retention_worker role is missing. It is a bootstrap role (see services/directus/schema/migrations/README.md), not a migration-created role, because migrations run as directus_migrator which does not hold CREATEROLE.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
END $$;

GRANT USAGE ON SCHEMA public TO retention_worker;
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM retention_worker;
REVOKE DELETE, TRUNCATE ON ALL TABLES IN SCHEMA public FROM directus_app;

-- App read surface: the schedule is not a secret, and an operator who cannot
-- see when a record is due cannot answer a data subject's question about it.
GRANT SELECT ON people, retention_anchor_sources, retention_class_sources,
                retention_policies, retention_clocks, legal_holds,
                retention_runs, retention_run_items TO directus_app;

-- Placing a hold is an ordinary app action; doing it as directus_app means the
-- DPO can hold from the UI without a shell.
GRANT INSERT ON legal_holds TO directus_app;

-- The worker reads the manifest and the config; it erases only via the engine.
GRANT SELECT ON retention_policies, retention_clocks, retention_anchor_sources,
                retention_class_sources, legal_holds,
                retention_runs, retention_run_items, people TO retention_worker;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO retention_worker;
