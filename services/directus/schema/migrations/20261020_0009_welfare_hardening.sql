-- 20261020_0009_welfare_hardening.sql
--
-- Slice 3 welfare hardening (AFC-472, parent AFC-463). Spec authority:
-- docs/planning/data-model.md §6 (welfare_cases, welfare_contributions,
-- welfare_case_events), permission matrix §10 + §10.1 (description /
-- outcome_notes restricted reads).
--
-- WHAT THIS FILE CREATES (tables owned by no earlier migration -- verified:
-- no welfare table exists in services/directus/schema/migrations/):
--   welfare_cases         -- §6.1 + confidentiality enum (branch, area).
--   welfare_contributions -- §6.2.
--   welfare_case_events   -- §6.3 + freeform `body` text column (detail stays
--     the short summary) + `note` event type + (case, created_at) index.
--
-- CHOICE, STATED (spec: "add welfare_case_notes OR extend
-- welfare_case_events"): extended welfare_case_events. One audit table stays
-- the single trail (every create/status-change/assign/note/contribution
-- writes a row here); a second notes table would fork the trail and need its
-- own audit. `body` is nullable text for long freeform notes.
--
-- ENUM DEVIATIONS (recorded, not silent -- the live portal predates this
-- migration and already stores values outside the §6 enums; rejecting them
-- here would fail existing Directus rows, so the CHECKs admit the union and
-- new rows use the spec values):
--   cases.category: spec (financial, medical, food, housing, bereavement,
--     education, other) UNION portal-observed (medical, financial,
--     bereavement, education, other). Union = spec set (portal set is a
--     subset); food/housing accepted but unused by the portal today.
--   cases.status: spec (open, in_progress, pending_approval, resolved,
--     closed) UNION portal-observed (open, in_progress, resolved, closed).
--   cases.priority: spec (low, medium, high, urgent) UNION portal-observed
--     (low, normal, high, urgent). Both medium and normal accepted; the
--     portal form offers normal, the report groups whatever is stored.
--   contributions.status: spec (proposed, approved, disbursed) UNION portal
--     (pending, approved, disbursed).
--   events.event_type: spec (created, status_changed, assigned, note,
--     contribution_added) UNION portal-observed (created, status, updated,
--     contribution, contribution_status). A status-enum cleanup, if the
--     board wants it, is its own ticket with its own approval -- not done
--     here on personal data including minors.
--   cases.title: §6.1 marks it required, but the live portal creates cases
--     without a title (case_ref is the identifier). NOT NULL here would
--     fail existing rows, so title is nullable. cases.person: §6.1 marks it
--     required, but the live portal holds walk-in cases with no linked
--     person row yet; person is nullable here so those rows survive, and
--     scope still holds because branch stays NOT NULL. Same for branch on paper
--     (§6.1 required): nullable here would open a scope hole, so branch
--     stays NOT NULL -- Directus rows without a branch fail closed at the
--     route layer (unscoped session, data-model §9 rule 5).
--
-- FK POLICY: people/branch links RESTRICT (a person/branch with cases is
-- not deleted by accident); case children CASCADE (events/contributions are
-- meaningless without their case). assigned_to / actor_user / approved_by /
-- contributed_by_person stay bare uuids: directus_users is a Directus system
-- collection with no table in this history, and people links for those
-- columns are operational lookups, not ownership.
--
-- GRANTS (data-model §10 pattern): Postgres sees ONE app identity, so
-- branch/assigned-owner scoping and the §10.1 description/outcome_notes
-- restriction live in the Directus policy + portal route filters, not here.
-- This layer states the ceiling: directus_app gets SELECT everywhere,
-- INSERT/UPDATE on operational columns, NO DELETE on any of the three
-- tables (cases hold children's personal data; events are the audit trail;
-- erasure runs as retention_worker, never through the API).
--
-- Rollback: rollback/20261020_0009_welfare_hardening.down.sql (refuses while
-- any of the three tables holds rows; drops in dependency order, no CASCADE).
-- Owner: migration role (directus_migrator). Never run as directus_app.
-- Role hygiene per ADR-0002: this file provisions no roles and grants no
-- role-creation or superuser capability; only GRANT/REVOKE below.
-- No durations, no awareness_at.

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
-- 1. welfare_cases (§6.1 + confidentiality).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS welfare_cases (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_ref          text NOT NULL UNIQUE CHECK (btrim(case_ref) <> ''),
  person            uuid REFERENCES people(id) ON DELETE RESTRICT,
  branch            uuid NOT NULL REFERENCES branches(id) ON DELETE RESTRICT,
  category          text NOT NULL DEFAULT 'other'
                      CHECK (category IN
                        ('financial', 'medical', 'food', 'housing',
                         'bereavement', 'education', 'other')),
  title             text,
  description       text,
  status            text NOT NULL DEFAULT 'open'
                      CHECK (status IN
                        ('open', 'in_progress', 'pending_approval',
                         'resolved', 'closed')),
  priority          text NOT NULL DEFAULT 'low'
                      CHECK (priority IN
                        ('low', 'medium', 'normal', 'high', 'urgent')),
  confidentiality   text NOT NULL DEFAULT 'branch'
                      CHECK (confidentiality IN ('branch', 'area')),
  assigned_to       uuid,
  opened_at         timestamptz NOT NULL DEFAULT now(),
  target_date       date,
  closed_at         timestamptz,
  amount_requested  numeric(12,2) CHECK (amount_requested IS NULL OR amount_requested >= 0),
  amount_approved   numeric(12,2) CHECK (amount_approved IS NULL OR amount_approved >= 0),
  outcome_notes     text
);

COMMENT ON TABLE welfare_cases IS
  'Welfare cases (data-model §6.1, AFC-472). description/outcome_notes are restricted reads (§10.1: assigned owner, branch admin, area/super admin -- enforced in Directus policy + portal stripHidden, not here). confidentiality branch = own-branch readers, area = area-wide readers (policy filter).';

-- Hardening on a table another deploy may already own (Directus-first
-- installs): every ALTER is IF NOT EXISTS / guarded, NOTICE-loud.
DO $$
BEGIN
  ALTER TABLE welfare_cases ADD COLUMN IF NOT EXISTS confidentiality text NOT NULL DEFAULT 'branch';
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'welfare_cases_confidentiality_valid') THEN
    ALTER TABLE welfare_cases
      ADD CONSTRAINT welfare_cases_confidentiality_valid
      CHECK (confidentiality IN ('branch', 'area'));
    RAISE NOTICE 'welfare_cases.confidentiality ensured (branch/area, default branch).';
  ELSE
    RAISE NOTICE 'welfare_cases.confidentiality check already present, left alone.';
  END IF;
  ALTER TABLE welfare_cases ADD COLUMN IF NOT EXISTS title text;
  ALTER TABLE welfare_cases ADD COLUMN IF NOT EXISTS target_date date;
  ALTER TABLE welfare_cases ADD COLUMN IF NOT EXISTS amount_approved numeric(12,2);
  ALTER TABLE welfare_cases ADD COLUMN IF NOT EXISTS outcome_notes text;
  ALTER TABLE welfare_cases ADD COLUMN IF NOT EXISTS description text;
EXCEPTION WHEN duplicate_object THEN
  RAISE NOTICE 'welfare_cases hardening columns already present, left alone.';
END
$$;

CREATE UNIQUE INDEX IF NOT EXISTS welfare_cases_case_ref_uidx
  ON welfare_cases (case_ref);
CREATE INDEX IF NOT EXISTS welfare_cases_branch_idx ON welfare_cases (branch);
CREATE INDEX IF NOT EXISTS welfare_cases_status_idx ON welfare_cases (status);
CREATE INDEX IF NOT EXISTS welfare_cases_person_idx ON welfare_cases (person);
CREATE INDEX IF NOT EXISTS welfare_cases_assigned_to_idx
  ON welfare_cases (assigned_to) WHERE assigned_to IS NOT NULL;
CREATE INDEX IF NOT EXISTS welfare_cases_priority_idx ON welfare_cases (priority);

-- ---------------------------------------------------------------------------
-- 2. welfare_contributions (§6.2).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS welfare_contributions (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "case"                uuid NOT NULL REFERENCES welfare_cases(id) ON DELETE CASCADE,
  contribution_type     text NOT NULL DEFAULT 'cash'
                          CHECK (contribution_type IN ('cash', 'goods', 'service')),
  description           text,
  amount                numeric(12,2) CHECK (amount IS NULL OR amount >= 0),
  currency              text NOT NULL DEFAULT 'NGN'
                          CHECK (currency IN ('NGN', 'USD', 'GBP')),
  contributed_by_person uuid REFERENCES people(id) ON DELETE SET NULL,
  contributed_by_name   text,
  contribution_date     date,
  approved_by           uuid,
  status                text NOT NULL DEFAULT 'proposed'
                          CHECK (status IN ('proposed', 'pending', 'approved', 'disbursed'))
);

COMMENT ON TABLE welfare_contributions IS
  'Contributions against a case (data-model §6.2, AFC-472). status admits proposed (spec) and pending (live portal); new rows use proposed.';

CREATE INDEX IF NOT EXISTS welfare_contributions_case_idx
  ON welfare_contributions ("case");
CREATE INDEX IF NOT EXISTS welfare_contributions_status_idx
  ON welfare_contributions (status);

-- ---------------------------------------------------------------------------
-- 3. welfare_case_events (§6.3 + body + note + (case, created_at)).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS welfare_case_events (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "case"      uuid NOT NULL REFERENCES welfare_cases(id) ON DELETE CASCADE,
  event_type  text NOT NULL DEFAULT 'note'
                CHECK (event_type IN
                  ('created', 'status_changed', 'status', 'updated',
                   'assigned', 'note', 'contribution_added',
                   'contribution', 'contribution_status')),
  detail      text,
  body        text,
  actor_user  uuid,
  created_at  timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE welfare_case_events IS
  'Explicit case audit (data-model §6.3, AFC-472). detail = short summary; body = nullable freeform note text. event_type admits the §6.3 set plus the live-portal values (status/updated/contribution/contribution_status); new note rows use note.';

DO $$
BEGIN
  ALTER TABLE welfare_case_events ADD COLUMN IF NOT EXISTS body text;
  RAISE NOTICE 'welfare_case_events.body ensured (nullable freeform note).';
  ALTER TABLE welfare_case_events ADD COLUMN IF NOT EXISTS detail text;
  ALTER TABLE welfare_case_events ADD COLUMN IF NOT EXISTS actor_user uuid;
EXCEPTION WHEN duplicate_object THEN
  RAISE NOTICE 'welfare_case_events hardening columns already present, left alone.';
END
$$;

-- The required index: (case, created_at) -- the timeline query predicate.
CREATE INDEX IF NOT EXISTS welfare_case_events_case_created_idx
  ON welfare_case_events ("case", created_at);
CREATE INDEX IF NOT EXISTS welfare_case_events_case_idx
  ON welfare_case_events ("case");
CREATE INDEX IF NOT EXISTS welfare_case_events_created_idx
  ON welfare_case_events (created_at);

-- ---------------------------------------------------------------------------
-- 4. Least-privilege ceiling (see header). No DELETE anywhere in this file:
--    cases hold children's personal data, events are the audit trail, and
--    erasure runs as retention_worker, never through the API.
-- ---------------------------------------------------------------------------
GRANT SELECT ON welfare_cases TO directus_app;
GRANT INSERT (case_ref, person, branch, category, title, description, status,
  priority, confidentiality, assigned_to, opened_at, target_date, closed_at,
  amount_requested, amount_approved, outcome_notes) ON welfare_cases TO directus_app;
GRANT UPDATE (case_ref, person, branch, category, title, description, status,
  priority, confidentiality, assigned_to, opened_at, target_date, closed_at,
  amount_requested, amount_approved, outcome_notes) ON welfare_cases TO directus_app;

GRANT SELECT ON welfare_contributions TO directus_app;
GRANT INSERT ("case", contribution_type, description, amount, currency,
  contributed_by_person, contributed_by_name, contribution_date, approved_by,
  status) ON welfare_contributions TO directus_app;
GRANT UPDATE ("case", contribution_type, description, amount, currency,
  contributed_by_person, contributed_by_name, contribution_date, approved_by,
  status) ON welfare_contributions TO directus_app;

GRANT SELECT ON welfare_case_events TO directus_app;
GRANT INSERT ("case", event_type, detail, body, actor_user) ON welfare_case_events TO directus_app;
GRANT UPDATE (detail, body) ON welfare_case_events TO directus_app;

REVOKE ALL ON welfare_cases FROM PUBLIC;
REVOKE ALL ON welfare_contributions FROM PUBLIC;
REVOKE ALL ON welfare_case_events FROM PUBLIC;
