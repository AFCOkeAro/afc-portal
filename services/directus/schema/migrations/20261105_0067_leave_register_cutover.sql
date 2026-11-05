-- 20261105_0067_leave_register_cutover.sql
--
-- Time Off leave-register cutover (AFC-1057/B, child AFC-1058).
-- Spec authority: ADR-0012 (leave register) + the AFC-1058 amendment that
-- keeps `leave_balances` (owned by 0055, HR phase 1) instead of dropping it.
-- NUMBER NOTE: on main the leave register ADR lands as ADR-0013 (ADR-0012
-- here is the minutes ADR; see ADR-0013's header for the collision). Every
-- "ADR-0012 (leave)" citation in this file means ADR-0013.
--
-- WHAT THIS FILE DOES: converts the main-shape `leave_requests` (0052:
-- person/days/leave_type incl. maternity/status
-- pending/approved/declined/cancelled, DELETE granted) to the ADR-0012
-- shape (requester_user NOT NULL + nullable requester_person, leave_type
-- annual/sick/compassionate/study/unpaid/other, status
-- pending/approved/rejected, decided_by/at stamped together, branch NOT
-- NULL + zone denorm, CHECK end >= start, no stored days), creates
-- `leave_request_events` with one `created` row per existing request, and
-- revokes DELETE on leave_requests from directus_app.
--
-- CHOICES, STATED (each maps to a report item on AFC-1058):
--   D1 maternity -> other, with one per-row `note` audit event recording
--      the original value and flagging HR review. The conversion is
--      explicit and audited, never silent; it applies only after HR
--      sign-off out of band (the sign-off is a precondition of apply,
--      not a column in this file).
--   D2 declined -> rejected, with one per-row `note` audit event. Pure
--      rename: the deciding officer refused the request in both vocabs.
--   D3 cancelled BLOCKS apply. HEAD has no cancelled state and mapping a
--      requester-withdrawn row to officer-rejected would rewrite history.
--      Every cancelled id is named in the refusal; the migrator disposes
--      them pre-cutover (confirm withdrawal intent, delete the row, or
--      have HR re-file), then re-runs. Nothing is silently dropped.
--   D4 requester_user backfills from created_by. Rows with created_by NULL
--      cannot be attributed, so they block apply and are named, never
--      defaulted to a placeholder user.
--   D5 requester_person backfills from person; the column stays nullable
--      and NULLs are kept (self-filed rows need no person link).
--   D6 branch becomes NOT NULL with a RESTRICT parent link (0052 allowed
--      NULL + SET NULL; a scopeless leave row is invisible fail-closed
--      per ADR-0012 §10). Rows with branch NULL block apply and are
--      named. Zone stays a SET NULL denorm, Flow-maintained.
--   D7 `days` is dropped. Used/remaining compute via workingDaysBetween.
--      SEMANTIC FLAG: 0052 stamped start..end inclusive over ALL 7 days
--      (2adbdbf); ADR-0012 counts Monday–Friday. Historic `days` values
--      and recomputed Mon–Fri counts WILL differ for any request touching
--      a weekend. Allowances planned against the old counts must be
--      re-checked; the pinned semantic from here on is Mon–Fri.
--   D8 DELETE on leave_requests is revoked from directus_app. Leave rows
--      are audited ministry facts; corrections are UPDATEs and removals
--      are reviewed migrator steps, never an API delete.
--   D9 `leave_balances` is NOT touched by this file. Main owns it via
--      0055 and the AFC-1058 amendment keeps it (ADR-0012 left it
--      unowned only because its slice was unspecced at the time).
--   D10 decided_by/decided_at travel together from here on. Legacy rows
--      with exactly one of the two set block apply and are named.
--   D11 created_at rides the events INSERT grant (deviation from the 0061
--      ceiling, which omitted it): the routes stamp the audit timeline
--      explicitly and the backfill must preserve it. Uniform explicit
--      stamps beat relying on DEFAULT now() in one path and not the other.
--
-- FAIL-CLOSED (§2): ownership by directus_migrator; 0052 shape present
-- (or the cutover already applied, in which case this file is a NOTICE
-- no-op); every unmappable row named in a restrict_violation refusal.
-- Follows the 0061 §2b pattern: name the file, name the rows, refuse.
--
-- RERUN: every step is guarded (IF NOT EXISTS / WHERE NOT EXISTS /
-- fixed constraint names), so a second apply changes nothing.
--
-- GRANTS (Dec.3, ADR-0012): Postgres sees one app identity, so scoping
-- lives in the Directus policy + portal routes. This layer states the
-- ceiling only: SELECT everywhere, INSERT/UPDATE on operational columns,
-- NO DELETE on either table. reason may hold health-adjacent free text:
-- the Directus policy withholds it from non-deciding roles and the portal
-- strips it (tasks.description precedent, 0013 §10 posture).
--
-- No roles provisioned (ADR-0002). Only GRANT/REVOKE below.
--
-- Rollback: rollback/20261105_0067_leave_register_cutover.down.sql
-- (refuses while either table holds rows; drops in dependency order, no
-- CASCADE). Owner: migration role (directus_migrator). Never run as
-- directus_app.
--
-- CTO APPROVAL (personal-data gate, ADR-0012): this register stores
-- personal data (requester identity, dates, free-text reason). This
-- cutover needs CTO approval before apply (diff attached, operator
-- backup, migrator role, rollback note). Recorded degradation: there is
-- no independent security reviewer on this team (board declined the seat
-- on cost), so CTO self-review is not independent review -- same
-- degradation as recorded in 0037. SecurityEngineer review is required
-- before this migration applies to staging.

-- ---------------------------------------------------------------------------
-- 0. Bootstrap roles exist. Fail closed naming this file, per the 0001/0002
--    pattern: a deploy that skipped bootstrap gets a sentence, not a
--    partial install. Only GRANT/REVOKE below -- this file mints no roles
--    (ADR-0002, scripts/migration-privilege-gate.sh).
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
-- 1. OWNERSHIP + SHAPE PRECONDITIONS. Brand-new cutover over the 0052
--    register: fail closed if the register is owned by someone else, or if
--    it matches neither the 0052 shape (has `days`) nor the cutover shape
--    (has `requester_user`, no `days`). Never widen the migration identity
--    to make this pass.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_foreign text;
  v_has_days boolean;
  v_has_requester_user boolean;
BEGIN
  SELECT string_agg(o, ', ' ORDER BY o) INTO v_foreign
    FROM (
      SELECT n.nspname || '.' || c.relname AS o
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public'
         AND c.relkind IN ('r', 'p')
         AND c.relname IN ('leave_requests', 'leave_request_events')
         AND c.relowner <> 'directus_migrator'::regrole
    ) AS foreign_objects;

  IF v_foreign IS NOT NULL THEN
    RAISE EXCEPTION
      'refusing the leave cutover (0067): % is not owned by '
      'directus_migrator, and only an owner may reshape it. '
      'Transfer ownership to directus_migrator first, then re-run this '
      'migration. Never widen the migration identity to make this pass.',
      v_foreign
      USING ERRCODE = 'restrict_violation';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'leave_requests'
       AND column_name = 'days'
  ) INTO v_has_days;
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'leave_requests'
       AND column_name = 'requester_user'
  ) INTO v_has_requester_user;

  IF NOT v_has_days AND NOT v_has_requester_user THEN
    RAISE EXCEPTION
      'refusing the leave cutover (0067): leave_requests matches neither '
      'the 0052 shape (column `days`) nor the ADR-0012 shape (column '
      '`requester_user`). Reconcile the table out of band, then re-run.'
      USING ERRCODE = 'restrict_violation';
  END IF;

  IF NOT v_has_days AND v_has_requester_user THEN
    RAISE NOTICE 'leave_requests 0067: cutover shape already present; remaining steps are no-ops.';
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- 2. FAIL-CLOSED ROW SCANS. Each names every offending id. D3/D4/D6/D10:
--    these block apply; the fix is out-of-band disposal or attribution,
--    then re-run. Counts for D1/D2 are NOTICEs: those rows convert with
--    an audit note (see §3).
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_unmapped text;
  v_nobranch text;
  v_noreason text;
  v_split_decision text;
  v_cancelled text;
  v_maternity integer;
  v_declined integer;
BEGIN
  SELECT string_agg(id::text, ', ' ORDER BY created_at, id) INTO v_unmapped
    FROM leave_requests WHERE created_by IS NULL;
  IF v_unmapped IS NOT NULL THEN
    RAISE EXCEPTION
      'refusing the leave cutover (0067): % request row(s) have created_by '
      'NULL and cannot be attributed to a requester_user: %. Name an owner '
      'for each row out of band (or dispose the row as migrator), then '
      're-run. Rows are never defaulted to a placeholder user.',
      (SELECT count(*) FROM leave_requests WHERE created_by IS NULL), v_unmapped
      USING ERRCODE = 'restrict_violation';
  END IF;

  SELECT string_agg(id::text, ', ' ORDER BY created_at, id) INTO v_nobranch
    FROM leave_requests WHERE branch IS NULL;
  IF v_nobranch IS NOT NULL THEN
    RAISE EXCEPTION
      'refusing the leave cutover (0067): % request row(s) have branch '
      'NULL, but the ADR-0012 register requires branch NOT NULL (a '
      'scopeless leave row is invisible fail-closed): %. Resolve each '
      'row''s branch out of band, then re-run.',
      (SELECT count(*) FROM leave_requests WHERE branch IS NULL), v_nobranch
      USING ERRCODE = 'restrict_violation';
  END IF;

  SELECT string_agg(id::text, ', ' ORDER BY created_at, id) INTO v_noreason
    FROM leave_requests WHERE reason IS NULL OR btrim(reason) = '';
  IF v_noreason IS NOT NULL THEN
    RAISE EXCEPTION
      'refusing the leave cutover (0067): % request row(s) have a NULL or '
      'blank reason, but the ADR-0012 register requires reason NOT NULL '
      'and non-blank: %. Record a reason for each row out of band, then '
      're-run.',
      (SELECT count(*) FROM leave_requests WHERE reason IS NULL OR btrim(reason) = ''), v_noreason
      USING ERRCODE = 'restrict_violation';
  END IF;

  SELECT string_agg(id::text, ', ' ORDER BY created_at, id) INTO v_split_decision
    FROM leave_requests
   WHERE (decided_by IS NULL) <> (decided_at IS NULL);
  IF v_split_decision IS NOT NULL THEN
    RAISE EXCEPTION
      'refusing the leave cutover (0067): % request row(s) carry a split '
      'decision stamp (exactly one of decided_by/decided_at is NULL), but '
      'the ADR-0012 register stamps them together: %. Repair each row out '
      'of band, then re-run.',
      (SELECT count(*) FROM leave_requests WHERE (decided_by IS NULL) <> (decided_at IS NULL)),
      v_split_decision
      USING ERRCODE = 'restrict_violation';
  END IF;

  SELECT string_agg(id::text, ', ' ORDER BY created_at, id) INTO v_cancelled
    FROM leave_requests WHERE status = 'cancelled';
  IF v_cancelled IS NOT NULL THEN
    RAISE EXCEPTION
      'refusing the leave cutover (0067): % request row(s) are cancelled, '
      'and the ADR-0012 vocabulary (pending/approved/rejected) has no '
      'cancelled state: %. Mapping a requester-withdrawn row to '
      'officer-rejected would rewrite history, and silently dropping the '
      'rows is forbidden. Confirm withdrawal intent for each row and '
      'dispose it as migrator (or have HR re-file), then re-run.',
      (SELECT count(*) FROM leave_requests WHERE status = 'cancelled'), v_cancelled
      USING ERRCODE = 'restrict_violation';
  END IF;

  SELECT count(*) INTO v_maternity FROM leave_requests WHERE leave_type = 'maternity';
  SELECT count(*) INTO v_declined FROM leave_requests WHERE status = 'declined';
  RAISE NOTICE 'leave_requests 0067: % maternity row(s) will map to ''other'' with an audit note (D1, HR sign-off required).', v_maternity;
  RAISE NOTICE 'leave_requests 0067: % declined row(s) will map to ''rejected'' with an audit note (D2 rename).', v_declined;
END
$$;

-- ---------------------------------------------------------------------------
-- 3. RESHAPE leave_requests to the ADR-0012 shape. Rerunnable: new columns
--    arrive IF NOT EXISTS, backfills only fill gaps, maps only touch
--    legacy values, constraints land under FIXED names.
-- ---------------------------------------------------------------------------
ALTER TABLE leave_requests
  ADD COLUMN IF NOT EXISTS requester_user uuid,
  ADD COLUMN IF NOT EXISTS requester_person uuid;

-- D4/D5 backfill (rerunnable: only fills NULLs, never overwrites; the
-- person leg runs only while the legacy column still exists, so a second
-- apply after the DROP below does not reference a dropped column).
UPDATE leave_requests SET requester_user = created_by WHERE requester_user IS NULL;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'leave_requests'
       AND column_name = 'person'
  ) THEN
    UPDATE leave_requests SET requester_person = person
      WHERE requester_person IS NULL AND person IS NOT NULL;
  END IF;
END
$$;

-- Drop the 0052-era CHECKs and FKs before re-adding the audited set.
-- Only 0052 ever wrote constraints onto this table (verified: no other
-- migration in services/directus/schema/migrations/ names it), so every
-- non-audited CHECK/FK here is 0052's.
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT conname FROM pg_constraint
     WHERE conrelid = 'public.leave_requests'::regclass
       AND contype = 'c'
       AND conname NOT IN (
         'leave_requests_dates_ordered',
         'leave_requests_decision_stamped_together',
         'leave_requests_type_allowed',
         'leave_requests_status_allowed',
         'leave_requests_reason_nonblank')
  LOOP
    EXECUTE format('ALTER TABLE leave_requests DROP CONSTRAINT %I', r.conname);
    RAISE NOTICE 'leave_requests 0067 dropped legacy CHECK %.', r.conname;
  END LOOP;

  FOR r IN
    SELECT conname FROM pg_constraint
     WHERE conrelid = 'public.leave_requests'::regclass
       AND contype = 'f'
       AND conname NOT IN (
         'leave_requests_branch_fkey',
         'leave_requests_zone_fkey',
         'leave_requests_person_fkey')
  LOOP
    EXECUTE format('ALTER TABLE leave_requests DROP CONSTRAINT %I', r.conname);
    RAISE NOTICE 'leave_requests 0067 dropped legacy FK %.', r.conname;
  END LOOP;
END
$$;

-- D1/D2 value maps run here, AFTER the legacy CHECKs are dropped and
-- before the audited set is added: each map runs as UPDATE ... RETURNING inside
-- a data-modifying CTE, so the note names exactly the rows that converted
-- without any staging table (the migration identity holds no TEMP
-- privilege by design, and a permanent staging table would be leftover
-- state). The events table must exist first, so it is created here
-- rather than in §4.
CREATE TABLE IF NOT EXISTS leave_request_events (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  leave_request uuid NOT NULL REFERENCES leave_requests(id) ON DELETE CASCADE,
  event_type    text NOT NULL DEFAULT 'note',
  detail        text,
  actor_user    uuid,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT leave_request_events_type_allowed
    CHECK (event_type IN ('created', 'updated', 'status_changed', 'note'))
);

COMMENT ON TABLE leave_request_events IS
  'Explicit leave-request audit (AFC-1058 cutover 0067; welfare_case_events precedent). Portal routes write created/status_changed/note; the cutover backfills created rows plus conversion notes; corrections are new rows.';

CREATE INDEX IF NOT EXISTS leave_request_events_request_created_idx
  ON leave_request_events (leave_request, created_at);

-- Fail-closed reconciliation for a pre-existing events table (0061 §2b
-- pattern): if the table predates this cutover but misses the audited
-- CHECK, refuse rather than adopt the unaudited shape.
DO $$
DECLARE
  v_missing text;
BEGIN
  SELECT string_agg(c, ', ') INTO v_missing
    FROM unnest(ARRAY['leave_request_events_type_allowed']) AS c
   WHERE NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = c);

  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION
      'leave_requests 0067 refuses to adopt the events shape: required CHECK constraint(s) % absent. Reconcile the leave_request_events table out of band, then re-run.',
      v_missing
      USING ERRCODE = 'restrict_violation';
  END IF;
END
$$;

-- D1 conversion: maternity -> other with a per-row audit note (rerunnable:
-- the UPDATE matches only legacy values, so a second apply converts and
-- notes nothing).
WITH mapped AS (
  UPDATE leave_requests SET leave_type = 'other'
    WHERE leave_type = 'maternity'
    RETURNING id, requester_user
)
INSERT INTO leave_request_events (leave_request, event_type, detail, actor_user, created_at)
SELECT id, 'note',
       'cutover 0067 (D1): leave_type was maternity, mapped to other. HR review sign-off required.',
       requester_user, now()
  FROM mapped;

-- D2 conversion: declined -> rejected with a per-row audit note (same
-- rerunnable shape; deciding-officer refusal in both vocabs).
WITH mapped AS (
  UPDATE leave_requests SET status = 'rejected'
    WHERE status = 'declined'
    RETURNING id, requester_user
)
INSERT INTO leave_request_events (leave_request, event_type, detail, actor_user, created_at)
SELECT id, 'note',
       'cutover 0067 (D2): status was declined, renamed to rejected (deciding-officer refusal in both vocabs).',
       requester_user, now()
  FROM mapped;

-- D6: branch required from here on.
ALTER TABLE leave_requests ALTER COLUMN requester_user SET NOT NULL;
ALTER TABLE leave_requests ALTER COLUMN branch SET NOT NULL;
ALTER TABLE leave_requests ALTER COLUMN reason SET NOT NULL;

-- Audited CHECK set (FIXED names; the 0061 §2b reconciliation shape).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'leave_requests_dates_ordered') THEN
    ALTER TABLE leave_requests ADD CONSTRAINT leave_requests_dates_ordered
      CHECK (end_date >= start_date);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'leave_requests_decision_stamped_together') THEN
    ALTER TABLE leave_requests ADD CONSTRAINT leave_requests_decision_stamped_together
      CHECK ((decided_by IS NULL AND decided_at IS NULL)
          OR (decided_by IS NOT NULL AND decided_at IS NOT NULL));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'leave_requests_type_allowed') THEN
    ALTER TABLE leave_requests ADD CONSTRAINT leave_requests_type_allowed
      CHECK (leave_type IN ('annual', 'sick', 'compassionate', 'study', 'unpaid', 'other'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'leave_requests_status_allowed') THEN
    ALTER TABLE leave_requests ADD CONSTRAINT leave_requests_status_allowed
      CHECK (status IN ('pending', 'approved', 'rejected'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'leave_requests_reason_nonblank') THEN
    ALTER TABLE leave_requests ADD CONSTRAINT leave_requests_reason_nonblank
      CHECK (btrim(reason) <> '');
  END IF;
END
$$;

-- Conditional parent links (the 0003 merge-contract pattern): branch and
-- requester_person RESTRICT (a requested leave never deletes its branch or
-- person by accident); zone denorm SET NULL. Directus-owned ids
-- (requester_user, decided_by, created_by) stay bare uuids, no FK (0037
-- precedent: the audit must survive the auth store's lifecycle).
DO $$
BEGIN
  IF to_regclass('public.branches') IS NULL THEN
    RAISE NOTICE 'Skipping leave_requests_branch_fkey: branches not present.';
  ELSIF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'leave_requests_branch_fkey') THEN
    ALTER TABLE leave_requests ADD CONSTRAINT leave_requests_branch_fkey
      FOREIGN KEY (branch) REFERENCES branches(id) ON DELETE RESTRICT;
    RAISE NOTICE 'leave_requests_branch_fkey ensured (RESTRICT).';
  END IF;

  IF to_regclass('public.zones') IS NULL THEN
    RAISE NOTICE 'Skipping leave_requests_zone_fkey: zones not present.';
  ELSIF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'leave_requests_zone_fkey') THEN
    ALTER TABLE leave_requests ADD CONSTRAINT leave_requests_zone_fkey
      FOREIGN KEY (zone) REFERENCES zones(id) ON DELETE SET NULL;
    RAISE NOTICE 'leave_requests_zone_fkey ensured (denorm SET NULL).';
  END IF;

  IF to_regclass('public.people') IS NULL THEN
    RAISE NOTICE 'Skipping leave_requests_person_fkey: people not present.';
  ELSIF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'leave_requests_person_fkey') THEN
    ALTER TABLE leave_requests ADD CONSTRAINT leave_requests_person_fkey
      FOREIGN KEY (requester_person) REFERENCES people(id) ON DELETE RESTRICT;
    RAISE NOTICE 'leave_requests_person_fkey ensured (RESTRICT).';
  END IF;
END
$$;

-- Zone denorm backfill where the branch parent is known. Rerunnable: only
-- rows whose zone is still NULL and whose branch has a zone move.
DO $$
BEGIN
  IF to_regclass('public.leave_requests') IS NOT NULL
     AND to_regclass('public.branches') IS NOT NULL THEN
    UPDATE leave_requests l SET zone = br.zone
      FROM branches br WHERE l.zone IS NULL AND l.branch = br.id AND br.zone IS NOT NULL;
    RAISE NOTICE 'leave_requests zone denorm backfilled from branch.';
  END IF;
END
$$;

-- D7: drop the stored day count (used/remaining compute via
-- workingDaysBetween, Mon–Fri). The column's CHECK dies with it.
ALTER TABLE leave_requests DROP COLUMN IF EXISTS days;
ALTER TABLE leave_requests DROP COLUMN IF EXISTS person;

COMMENT ON TABLE leave_requests IS
  'Time Off leave register (AFC-1058 cutover 0067 over AFC-842 0052, ADR-0012). One row per request: requester_user required (+ requester_person where resolvable), type enum (maternity mapped to other on cutover, see audit notes), ordered start/end dates, non-blank reason, pending/approved/rejected lifecycle (declined renamed to rejected on cutover); decided_by/at stamped together on decision by the route. Branch required for §10 scoping; zone is a Flow-maintained denorm; reason is a restricted read (deciding officers + area via policy, stripped in routes). days was dropped: used/remaining compute via workingDaysBetween (Mon–Fri).';

CREATE INDEX IF NOT EXISTS leave_requests_requester_status_idx
  ON leave_requests (requester_user, status);
CREATE INDEX IF NOT EXISTS leave_requests_branch_idx
  ON leave_requests (branch);
CREATE INDEX IF NOT EXISTS leave_requests_zone_idx
  ON leave_requests (zone) WHERE zone IS NOT NULL;
CREATE INDEX IF NOT EXISTS leave_requests_status_idx
  ON leave_requests (status);
CREATE INDEX IF NOT EXISTS leave_requests_start_date_idx
  ON leave_requests (start_date);

-- ---------------------------------------------------------------------------
-- 4. `created` backfill (explicit audit, transfer_events precedent).
--    One `created` row per pre-cutover request (rerunnable: skips rows
--    that already carry one, preserving the original timeline). The events
--    table itself is created in §3 so the D1/D2 maps can note against it
--    before the audited CHECK set lands.
-- ---------------------------------------------------------------------------
-- Backfill: one `created` row per request (rerunnable: skips rows that
-- already carry a created event, preserving the original timeline).
INSERT INTO leave_request_events (leave_request, event_type, detail, actor_user, created_at)
SELECT l.id, 'created', 'cutover 0067 backfill: request filed pre-cutover', l.requester_user, l.created_at
  FROM leave_requests l
 WHERE NOT EXISTS (
   SELECT 1 FROM leave_request_events e
    WHERE e.leave_request = l.id AND e.event_type = 'created'
 );

-- ---------------------------------------------------------------------------
-- 5. Least-privilege ceiling (see header). REVOKE ALL first so the 0052
--    DELETE grant and the dropped-column (person/days) grants die with the
--    old shape; then the precise ADR-0012 grants. NO DELETE anywhere in
--    this file (D8): leave rows are audited ministry facts.
-- ---------------------------------------------------------------------------
REVOKE ALL ON leave_requests FROM directus_app;
GRANT SELECT ON leave_requests TO directus_app;
GRANT INSERT (requester_user, requester_person, branch, zone, leave_type, start_date, end_date, reason, status, decided_by, decided_at, created_by)
  ON leave_requests TO directus_app;
GRANT UPDATE (requester_person, zone, leave_type, start_date, end_date, reason, status, decided_by, decided_at)
  ON leave_requests TO directus_app;

GRANT SELECT ON leave_request_events TO directus_app;
-- created_at rides the INSERT list (unlike the 0061 ceiling): both the
-- routes and the cutover backfill stamp the audit timeline explicitly
-- instead of relying on DEFAULT now().
GRANT INSERT (leave_request, event_type, detail, actor_user, created_at)
  ON leave_request_events TO directus_app;
GRANT UPDATE (detail) ON leave_request_events TO directus_app;

REVOKE ALL ON leave_requests FROM PUBLIC;
REVOKE ALL ON leave_request_events FROM PUBLIC;
