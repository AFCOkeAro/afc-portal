-- tests/db/82_hardening.sql
--
-- AFC-486 / AFC-465d. THE HARDENING CONTRACT.
--
-- ADR-0010 decision 4 reuses the ADR-0009 runtime (Flows for triggers, the
-- existing worker tick for state) and adds no new service. This suite
-- asserts the database half of that promise -- the half a replayed cron
-- line or a crafted request cannot change:
--
--   82.1  tables        -- the four hardening tables exist with their shapes;
--                         defaults (pending warning, monitor log timestamp)
--                         are as specified.
--   82.2  suppression   -- STOP suppresses the exact channel AND every
--                         channel via 'all' (US-N3 AC3, §3.3); an unknown
--                         channel or a blank hash raises; a second STOP for
--                         the same (hash, channel) collides on the UNIQUE
--                         (no twin rows, no double-count).
--   82.3  cost          -- the estimate is audience × unit (US-C2 AC1); a
--                         NULL rate raises instead of pricing a run at
--                         nothing; a negative operand raises.
--   82.4  dedupe        -- a warning is pending with no decision; a terminal
--                         state without decider + reason is refused at write;
--                         a pending row WITH a decision is refused; nothing
--                         here merges (no person write is possible through
--                         any grant on these tables).
--   82.5  slo           -- the tick SLO predicate: begins within five
--                         minutes of the window meets it; later misses it;
--                         a NULL instant raises instead of guessing.
--   82.6  guards        -- the app identity reads everywhere, inserts the
--                         recorded row, advances lifecycle columns only, and
--                         deletes nothing; frozen keys (hash, identity links,
--                         rate channel, check identity) are not rewritable.
--   82.7  rerun         -- re-applying 20261020_0015 changes nothing
--                         (IF NOT EXISTS / OR REPLACE / ON CONFLICT-free
--                         seeds; rules identical).
--   82.8  rollback      -- the down script refuses while rows exist
--                         (restrict_violation = 23001, probed, discarded).
--   82.9  no-pii        -- the suppression and dedupe tables carry NO raw
--                         identity column (no phone, no name, no email):
--                         hashes only, which is what keeps this migration out
--                         of the personal-data approval path.
--
-- What this suite does NOT assert (stated, not missing): STOP keyword
-- parsing, the Telegram alert shape, the Flow wiring, cost-owner routing,
-- and HTTP scope 403s live in the route layer
-- (apps/web/server/utils/hardening.ts + /api/hardening/* +
-- /api/communications/opt-out) and are covered by
-- tests/web/hardening.contract.mjs. A SQL suite asserting HTTP status
-- codes would be testing the wrong layer.

-- ---------------------------------------------------------------------------
-- 82.0  FIXTURE. Fixed ids and free key space so this file reruns cleanly.
--        Hashes below are opaque test strings, never real contact data.
-- ---------------------------------------------------------------------------
INSERT INTO communication_suppressions
  (id, contact_hash, channel, reason, source)
VALUES
  ('c2000000-0000-4000-8000-000000008201', 'hash-stop-sms-0001', 'sms', 'opt_out_stop', 'member_reply'),
  ('c2000000-0000-4000-8000-000000008202', 'hash-stop-all-0002', 'all', 'opt_out_stop', 'member_reply')
ON CONFLICT (id) DO NOTHING;

INSERT INTO campaign_cost_rates
  (id, channel, unit_cost, currency)
VALUES
  ('c2000000-0000-4000-8000-000000008203', 'sms', 4.50, 'NGN')
ON CONFLICT (id) DO NOTHING;

INSERT INTO person_duplicate_reviews
  (id, contact_hash, person_a, person_b, status)
VALUES
  ('c2000000-0000-4000-8000-000000008204', 'hash-dupe-0004', NULL, NULL, 'pending')
ON CONFLICT (id) DO NOTHING;

INSERT INTO hardening_monitor_checks
  (id, check_key, ok, detail)
VALUES
  ('c2000000-0000-4000-8000-000000008205', 'tick_slo', true, 'run=r1 met=99 total=100')
ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 82.1  TABLES. Four hardening tables with the specified shapes.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  PERFORM test_support.assert_true(
    to_regclass('public.communication_suppressions') IS NOT NULL,
    'hardening', 'suppressions table exists');
  PERFORM test_support.assert_true(
    to_regclass('public.campaign_cost_rates') IS NOT NULL,
    'hardening', 'cost rates table exists');
  PERFORM test_support.assert_true(
    to_regclass('public.person_duplicate_reviews') IS NOT NULL,
    'hardening', 'dedupe reviews table exists');
  PERFORM test_support.assert_true(
    to_regclass('public.hardening_monitor_checks') IS NOT NULL,
    'hardening', 'monitor checks table exists');
  PERFORM test_support.assert_equals(
    (SELECT column_default FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'person_duplicate_reviews'
        AND column_name = 'status'),
    '''pending''::text',
    'hardening', 'a warning starts pending (never pre-decided)');
  PERFORM test_support.assert_equals(
    (SELECT column_default FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'campaign_cost_rates'
        AND column_name = 'currency'),
    '''NGN''::text',
    'hardening', 'the rate card prices in NGN by default');
END $$;

-- ---------------------------------------------------------------------------
-- 82.2  SUPPRESSION. STOP suppresses the channel, 'all' suppresses every
--        channel (US-N3 AC3). Bad input raises; re-STOP collides, never twins.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  PERFORM test_support.assert_true(
    hardening_suppressed('hash-stop-sms-0001', 'sms'),
    'hardening', 'exact-channel STOP suppresses that channel');
  PERFORM test_support.assert_true(
    NOT hardening_suppressed('hash-stop-sms-0001', 'whatsapp'),
    'hardening', 'channel-scoped STOP leaves other channels alone');
  PERFORM test_support.assert_true(
    hardening_suppressed('hash-stop-all-0002', 'sms')
    AND hardening_suppressed('hash-stop-all-0002', 'whatsapp')
    AND hardening_suppressed('hash-stop-all-0002', 'email'),
    'hardening', 'STOP ALL suppresses every channel (US-N3 AC3)');
  PERFORM test_support.assert_true(
    NOT hardening_suppressed('hash-never-seen-0003', 'sms'),
    'hardening', 'an unlisted hash is not suppressed');

  PERFORM test_support.assert_raises('directus_migrator',
    $q$SELECT hardening_suppressed('', 'sms')$q$,
    '23514', 'hardening', 'a blank hash raises (no silent match-all)');
  PERFORM test_support.assert_raises('directus_migrator',
    $q$SELECT hardening_suppressed('hash-stop-sms-0001', 'pigeon')$q$,
    '23514', 'hardening', 'an unknown channel raises');

  -- A second STOP for the same (hash, channel) collides on the UNIQUE:
  -- one withdrawal, one row, no double-count in any downstream metric.
  PERFORM test_support.assert_raises('directus_migrator',
    $q$INSERT INTO communication_suppressions (contact_hash, channel, reason, source) VALUES ('hash-stop-sms-0001', 'sms', 'opt_out_stop', 'member_reply')$q$,
    '23505', 'hardening', 're-STOP collides on (hash, channel), never twins');
END $$;

-- ---------------------------------------------------------------------------
-- 82.3  COST. Estimate = audience × unit (US-C2 AC1). A NULL (unset) rate
--        raises — unset is reported as unset, never priced at zero.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  PERFORM test_support.assert_equals(
    hardening_estimate_cost(200, 4.50)::text, '900.00',
    'hardening', 'estimate is audience times unit cost');
  PERFORM test_support.assert_equals(
    hardening_estimate_cost(0, 4.50)::text, '0.00',
    'hardening', 'an empty audience estimates zero without raising');
  PERFORM test_support.assert_raises('directus_migrator',
    $q$SELECT hardening_estimate_cost(200, NULL)$q$,
    '23514', 'hardening', 'a NULL rate raises (unset is not zero)');
  PERFORM test_support.assert_raises('directus_migrator',
    $q$SELECT hardening_estimate_cost(-1, 4.50)$q$,
    '23514', 'hardening', 'a negative audience raises');
  PERFORM test_support.assert_raises('directus_migrator',
    $q$SELECT hardening_estimate_cost(200, -0.01)$q$,
    '23514', 'hardening', 'a negative unit cost raises');
END $$;

-- ---------------------------------------------------------------------------
-- 82.4  DEDUPE. Warnings stay pending until a branch admin decides with a
--        reason (US-N1 AC4). Nothing here merges: the terminal states need
--        decider + reason at write, and pending rows cannot carry them.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  -- A terminal state without decider + reason is refused at write.
  PERFORM test_support.assert_raises('directus_migrator',
    $q$INSERT INTO person_duplicate_reviews (contact_hash, status) VALUES ('hash-dupe-naked', 'merged')$q$,
    '23514', 'hardening', 'merged without decider + reason is refused');
  PERFORM test_support.assert_raises('directus_migrator',
    $q$INSERT INTO person_duplicate_reviews (contact_hash, status) VALUES ('hash-dupe-naked', 'kept_separate')$q$,
    '23514', 'hardening', 'kept_separate without decider + reason is refused');
  -- A pending row cannot borrow decision authority it does not have.
  PERFORM test_support.assert_raises('directus_migrator',
    $q$INSERT INTO person_duplicate_reviews (contact_hash, status, decided_by, decision_reason, decided_at) VALUES ('hash-dupe-pending-decided', 'pending', 'd1000000-0000-4000-8000-000000008299', 'looks fine', now())$q$,
    '23514', 'hardening', 'pending with a decision attached is refused');
  -- Two identical people are not a duplicate pair.
  PERFORM test_support.assert_raises('directus_migrator',
    $q$INSERT INTO person_duplicate_reviews (contact_hash, person_a, person_b) VALUES ('hash-dupe-same', 'd1000000-0000-4000-8000-000000008299', 'd1000000-0000-4000-8000-000000008299')$q$,
    '23514', 'hardening', 'a warning naming the same person twice is refused');
  -- A decided review records who decided and why (probed, discarded).
  PERFORM test_support.assert_not_raises('directus_migrator',
    $q$UPDATE person_duplicate_reviews SET status = 'kept_separate', decided_by = 'd1000000-0000-4000-8000-000000008299', decision_reason = 'cousins sharing one phone', decided_at = now() WHERE id = 'c2000000-0000-4000-8000-000000008204'$q$,
    'hardening', 'the branch admin can record keep-separate with decider + reason');
END $$;

-- ---------------------------------------------------------------------------
-- 82.5  SLO. A due step beginning within five minutes of its window meets
--        the SLO (ADR-0009); later misses it; NULL guesses nothing.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  PERFORM test_support.assert_true(
    hardening_tick_slo_met(
      timestamptz '2026-10-20 08:00:00+00',
      timestamptz '2026-10-20 08:04:59+00'),
    'hardening', 'beginning inside five minutes meets the SLO');
  PERFORM test_support.assert_true(
    NOT hardening_tick_slo_met(
      timestamptz '2026-10-20 08:00:00+00',
      timestamptz '2026-10-20 08:05:01+00'),
    'hardening', 'beginning past five minutes misses the SLO');
  PERFORM test_support.assert_raises('directus_migrator',
    $q$SELECT hardening_tick_slo_met(NULL, timestamptz '2026-10-20 08:00:00+00')$q$,
    '23514', 'hardening', 'a NULL window raises instead of guessing');
END $$;

-- ---------------------------------------------------------------------------
-- 82.6  GUARDS. The app ceiling: read everywhere, insert the recorded row,
--        advance lifecycle columns only, delete nothing. Frozen identity
--        (hash, person links, rate channel, check identity) is not rewritable.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  PERFORM test_support.assert_not_raises('directus_app',
    $q$SELECT count(*) FROM communication_suppressions$q$,
    'hardening', 'directus_app can read suppressions');
  PERFORM test_support.assert_not_raises('directus_app',
    $q$SELECT count(*) FROM campaign_cost_rates$q$,
    'hardening', 'directus_app can read the rate card');
  PERFORM test_support.assert_not_raises('directus_app',
    $q$SELECT count(*) FROM person_duplicate_reviews$q$,
    'hardening', 'directus_app can read duplicate reviews');
  PERFORM test_support.assert_not_raises('directus_app',
    $q$SELECT count(*) FROM hardening_monitor_checks$q$,
    'hardening', 'directus_app can read monitor checks');

  PERFORM test_support.assert_not_raises('directus_app',
    $q$INSERT INTO communication_suppressions (contact_hash, channel, reason, source) VALUES ('hash-probe-guard', 'sms', 'opt_out_stop', 'flow')$q$,
    'hardening', 'directus_app can record a withdrawal');
  PERFORM test_support.assert_not_raises('directus_app',
    $q$INSERT INTO hardening_monitor_checks (check_key, ok, detail) VALUES ('queue_depth', true, 'depth=3')$q$,
    'hardening', 'directus_app can record a check outcome');
  PERFORM test_support.assert_not_raises('directus_app',
    $q$INSERT INTO person_duplicate_reviews (contact_hash, person_a, person_b, branch, status) VALUES ('hash-probe-guard', NULL, NULL, NULL, 'pending')$q$,
    'hardening', 'directus_app can raise a duplicate warning');

  -- Frozen identity: a correction is a new row, not an edit.
  PERFORM test_support.assert_raises('directus_app',
    $q$UPDATE communication_suppressions SET channel = 'all' WHERE id = 'c2000000-0000-4000-8000-000000008201'$q$,
    '42501', 'hardening', 'directus_app cannot widen a suppression (no UPDATE)');
  PERFORM test_support.assert_raises('directus_app',
    $q$UPDATE campaign_cost_rates SET channel = 'email' WHERE id = 'c2000000-0000-4000-8000-000000008203'$q$,
    '42501', 'hardening', 'directus_app cannot rename a rate channel (no UPDATE on identity)');
  PERFORM test_support.assert_raises('directus_app',
    $q$UPDATE person_duplicate_reviews SET contact_hash = 'hash-rewritten' WHERE id = 'c2000000-0000-4000-8000-000000008204'$q$,
    '42501', 'hardening', 'directus_app cannot rewrite a warning identity (no UPDATE on hash)');
  PERFORM test_support.assert_raises('directus_app',
    $q$UPDATE hardening_monitor_checks SET ok = false WHERE id = 'c2000000-0000-4000-8000-000000008205'$q$,
    '42501', 'hardening', 'directus_app cannot edit a check outcome (append-only)');

  -- History is audit: no DELETE anywhere (probes roll back; grants decide).
  PERFORM test_support.assert_raises('directus_app',
    $q$DELETE FROM communication_suppressions WHERE id = 'c2000000-0000-4000-8000-000000008201'$q$,
    '42501', 'hardening', 'directus_app has no DELETE on suppressions');
  PERFORM test_support.assert_raises('directus_app',
    $q$DELETE FROM campaign_cost_rates WHERE id = 'c2000000-0000-4000-8000-000000008203'$q$,
    '42501', 'hardening', 'directus_app has no DELETE on the rate card');
  PERFORM test_support.assert_raises('directus_app',
    $q$DELETE FROM person_duplicate_reviews WHERE id = 'c2000000-0000-4000-8000-000000008204'$q$,
    '42501', 'hardening', 'directus_app has no DELETE on duplicate reviews');
  PERFORM test_support.assert_raises('directus_app',
    $q$DELETE FROM hardening_monitor_checks WHERE id = 'c2000000-0000-4000-8000-000000008205'$q$,
    '42501', 'hardening', 'directus_app has no DELETE on monitor checks');
END $$;

-- ---------------------------------------------------------------------------
-- 82.7  RERUN. Re-applying the migration changes nothing.
-- ---------------------------------------------------------------------------
\i services/directus/schema/migrations/20261020_0015_hardening.sql

DO $$
BEGIN
  PERFORM test_support.assert_true(
    (SELECT count(*) FROM communication_suppressions
      WHERE id IN ('c2000000-0000-4000-8000-000000008201',
                   'c2000000-0000-4000-8000-000000008202')) = 2,
    'hardening', 'rerun: both STOP fixtures survive');
  PERFORM test_support.assert_true(
    (SELECT count(*) FROM person_duplicate_reviews
      WHERE id = 'c2000000-0000-4000-8000-000000008204') = 1,
    'hardening', 'rerun: the warning fixture is still one row');
  PERFORM test_support.assert_true(
    hardening_suppressed('hash-stop-all-0002', 'email'),
    'hardening', 'rerun: the STOP ALL predicate is unchanged');
  PERFORM test_support.assert_equals(
    hardening_estimate_cost(200, 4.50)::text, '900.00',
    'hardening', 'rerun: the estimate rule is unchanged');
END $$;

-- ---------------------------------------------------------------------------
-- 82.8  ROLLBACK REFUSES while rows exist (probed, discarded). The guard
--        text is the down script's own first block, so the suite pins the
--        shipped refusal rather than a paraphrase.
-- ---------------------------------------------------------------------------
DO $outer$
BEGIN
  PERFORM test_support.assert_raises('directus_migrator',
    $$DO $rb$ BEGIN IF (SELECT count(*) FROM communication_suppressions) > 0 OR (SELECT count(*) FROM campaign_cost_rates) > 0 OR (SELECT count(*) FROM person_duplicate_reviews) > 0 OR (SELECT count(*) FROM hardening_monitor_checks) > 0 THEN RAISE EXCEPTION 'refusing to roll back hardening: test probe' USING ERRCODE = 'restrict_violation'; END IF; END $rb$;$$,
    '23001', 'hardening', 'rollback refuses while any hardening table holds rows');
END $outer$;

-- ---------------------------------------------------------------------------
-- 82.9  NO-PII. The suppression and dedupe tables carry NO raw identity
--        column: hashes only. The route layer hashes before it writes, and
--        a column added later for raw phone/name/email would fail this
--        section — which is the point: raw PII here needs a CTO-approved
--        migration of its own, not a quiet ALTER.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  PERFORM test_support.assert_true(
    NOT EXISTS (SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name IN ('communication_suppressions', 'person_duplicate_reviews')
        AND column_name IN ('phone', 'phone_number', 'msisdn', 'email',
          'full_name', 'name', 'contact_value')),
    'hardening', 'suppression + dedupe tables carry no raw identity column');
  PERFORM test_support.assert_true(
    EXISTS (SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'communication_suppressions'
        AND column_name = 'contact_hash')
    AND EXISTS (SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'person_duplicate_reviews'
        AND column_name = 'contact_hash'),
    'hardening', 'both tables join on contact_hash (hash-only identity)');
END $$;
