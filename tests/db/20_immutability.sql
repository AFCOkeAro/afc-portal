-- tests/db/20_immutability.sql
--
-- AFC-166 acceptance criterion 2. THE TEST THAT MATTERS.
--
-- The trivial implementation is "make the field read-only in Directus". That
-- proves nothing: data-model-v4.md 5 gives super admin CRUD on every
-- collection, and Directus holds exactly one database identity for every API
-- role. So two rejection mechanisms are asserted for two classes of identity:
--
--   directus_app                                     -> 42501 (grant list, layer 2)
--   directus_<each v4 role>, granted table-level ALL  -> 23001 (trigger, THE CONTROL)
--   test_table_super, granted table-level ALL         -> 23001
--   directus_migrator, the table owner               -> 23001
--
-- An implementation that only has the grant list fails every 23001 assertion.
-- Permissions are a control we can widen by accident; a trigger that rejects
-- even a fully-granted session is not something a role change removes.

-- The roles themselves come from tests/db/assert.sql. Here they get the most
-- generous table-level DML a Directus policy could ever map to -- including
-- TRUNCATE, which no Directus role would ever be granted and which therefore
-- proves the trigger is what stops a full register wipe.
DO $$
DECLARE
  v_role text;
  v_roles text[] := ARRAY[
    'super_admin', 'area_admin', 'branch_admin',
    'welfare_officer', 'staff_volunteer', 'member', 'public'
  ];
BEGIN
  FOREACH v_role IN ARRAY v_roles LOOP
    PERFORM test_support.as_role(NULL,
      format('GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE ON incidents TO directus_%I', v_role));
    PERFORM test_support.as_role(NULL,
      format('GRANT SELECT ON incidents_breach_clock TO directus_%I', v_role));
  END LOOP;

  PERFORM test_support.as_role(NULL,
    'GRANT ALL PRIVILEGES ON incidents TO test_table_super');
  PERFORM test_support.as_role(NULL,
    'GRANT ALL PRIVILEGES ON incidents_breach_clock TO test_table_super');
END
$$;

-- Fixture row, created as the runtime identity so its clock origin is genuinely
-- server-set.
DO $$
BEGIN
  PERFORM test_support.as_role('directus_app',
    $q$INSERT INTO incidents (ref, summary, severity, status, detected_at)
      VALUES ('IMMUT-FIXTURE', 'Fixture for the immutability suite', 'critical', 'open', now())$q$);
END $$;

-- Positive control FIRST. If ordinary edits were blocked, every rejection below
-- would pass for the wrong reason. A test that cannot fail for the right reason
-- is worse than no test.
DO $$
BEGIN
  PERFORM test_support.as_role('directus_app',
    $q$UPDATE incidents
          SET summary = 'Edited through Directus, which is allowed',
              status  = 'investigating'
        WHERE ref = 'IMMUT-FIXTURE'$q$);

  PERFORM test_support.assert_equals(
    (SELECT status FROM incidents WHERE ref = 'IMMUT-FIXTURE'),
    'investigating', 'immut',
    'positive control: an ordinary UPDATE through the runtime identity still succeeds');
END
$$;

DO $$
BEGIN
  -- Re-stating awareness_at with its own value is not a change, so it must not
  -- raise. Directus sends only the fields in the patch; an operator refreshing a
  -- row must never have to disable the trigger to do it. If this raised,
  -- operators would learn to disable it, and then the control is gone for real.
  PERFORM test_support.assert_not_raises('test_table_super',
    $q$UPDATE incidents
          SET summary = 'Re-stated unchanged',
              awareness_at = awareness_at
        WHERE ref = 'IMMUT-FIXTURE'$q$,
    'immut', 're-stating awareness_at with its own value is not a change and is allowed');

  PERFORM test_support.assert_not_raises('directus_app',
    $q$UPDATE incidents SET summary = 'Still allowed' WHERE ref = 'IMMUT-FIXTURE'$q$,
    'immut', 'positive control for the runtime identity: an unrelated field still updates');
END
$$;

-- ---------------------------------------------------------------------------
-- Layer 2: the grant list. directus_app has no privilege on either column.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  PERFORM test_support.assert_raises('directus_app',
    $q$UPDATE incidents SET awareness_at = awareness_at - interval '1 hour' WHERE ref = 'IMMUT-FIXTURE'$q$,
    '42501', 'immut', 'directus_app cannot UPDATE awareness_at');
  PERFORM test_support.assert_raises('directus_app',
    $q$UPDATE incidents
          SET awareness_at_source = 'backfill:earliest_of_detected_reported_created'
        WHERE ref = 'IMMUT-FIXTURE'$q$,
    '42501', 'immut', 'directus_app cannot UPDATE awareness_at_source');
  PERFORM test_support.assert_raises('directus_app',
    $q$DELETE FROM incidents WHERE ref = 'IMMUT-FIXTURE'$q$,
    '42501', 'immut', 'directus_app has no DELETE grant at all');
  PERFORM test_support.assert_raises('directus_app',
    $q$TRUNCATE incidents$q$,
    '42501', 'immut', 'directus_app cannot TRUNCATE the register');
END
$$;

-- ---------------------------------------------------------------------------
-- THE CONTROL: a fully-granted session is still rejected by the trigger.
-- One iteration per role in the v4 matrix, super admin first.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_role text;
  v_roles text[] := ARRAY[
    'super_admin', 'area_admin', 'branch_admin',
    'welfare_officer', 'staff_volunteer', 'member', 'public'
  ];
BEGIN
  FOREACH v_role IN ARRAY v_roles LOOP
    PERFORM test_support.assert_raises(format('directus_%s', v_role),
      format($q$UPDATE incidents SET awareness_at = awareness_at - interval '1 hour' WHERE ref = 'IMMUT-FIXTURE'$q$),
      '23001', 'immut', v_role || ': fully granted UPDATE still cannot move awareness_at');

    PERFORM test_support.assert_raises(format('directus_%s', v_role),
      format($q$UPDATE incidents
               SET awareness_at_source = 'backfill:earliest_of_detected_reported_created'
             WHERE ref = 'IMMUT-FIXTURE'$q$),
      '23001', 'immut', v_role || ': fully granted UPDATE still cannot rewrite provenance');

    PERFORM test_support.assert_raises(format('directus_%s', v_role),
      format($q$DELETE FROM incidents WHERE ref = 'IMMUT-FIXTURE'$q$),
      '23001', 'immut', v_role || ': a breach row cannot be deleted');

    PERFORM test_support.assert_raises(format('directus_%s', v_role),
      $q$TRUNCATE incidents$q$,
      '23001', 'immut', v_role || ': the register cannot be truncated');
  END LOOP;

  -- test_table_super: strictly more privilege than any Directus role can hold.
  PERFORM test_support.assert_raises('test_table_super',
    $q$UPDATE incidents SET awareness_at = '2000-01-01' WHERE ref = 'IMMUT-FIXTURE'$q$,
    '23001', 'immut', 'a role with ALL on the table still cannot backdate the clock origin');

  PERFORM test_support.assert_raises('test_table_super',
    $q$DELETE FROM incidents WHERE ref = 'IMMUT-FIXTURE'$q$,
    '23001', 'immut', 'a role with ALL on the table still cannot delete a breach row');

  -- The table owner. The trigger fires for the owner too.
  PERFORM test_support.assert_raises('directus_migrator',
    $q$UPDATE incidents SET awareness_at = awareness_at - interval '1 hour' WHERE ref = 'IMMUT-FIXTURE'$q$,
    '23001', 'immut', 'table owner cannot move awareness_at without disabling the trigger first');

  PERFORM test_support.assert_raises('directus_migrator',
    $q$DELETE FROM incidents WHERE ref = 'IMMUT-FIXTURE'$q$,
    '23001', 'immut', 'table owner cannot delete a breach row');
END
$$;

-- ---------------------------------------------------------------------------
-- Credential split: the runtime identity must not be able to remove the
-- control. ALTER TABLE ... DISABLE TRIGGER requires table ownership, so the
-- grant list is not enough -- the migration credential and the runtime
-- credential have to be different roles.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  PERFORM test_support.assert_raises('directus_app',
    $q$ALTER TABLE incidents DISABLE TRIGGER incidents_immutable_awareness$q$,
    '42501', 'immut', 'directus_app cannot disable the guard trigger: it is not the table owner');
  PERFORM test_support.assert_raises('directus_app',
    $q$ALTER TABLE incidents DISABLE TRIGGER incidents_no_delete$q$,
    '42501', 'immut', 'directus_app cannot disable the no-delete trigger');
  PERFORM test_support.assert_raises('directus_app',
    $q$ALTER TABLE incidents DISABLE TRIGGER incidents_no_truncate$q$,
    '42501', 'immut', 'directus_app cannot disable the no-truncate trigger');
  PERFORM test_support.assert_raises('test_table_super',
    $q$ALTER TABLE incidents DISABLE TRIGGER incidents_immutable_awareness$q$,
    '42501', 'immut', 'a role with ALL on the table still cannot disable the trigger');
  PERFORM test_support.assert_raises('directus_app',
    $q$DROP TRIGGER incidents_immutable_awareness ON incidents$q$,
    '42501', 'immut', 'directus_app cannot drop the guard trigger');
END
$$;

-- ---------------------------------------------------------------------------
-- Documented residual risk, asserted rather than assumed: the table owner can
-- disable the trigger, and with it disabled can backdate the clock origin.
--
-- The probe runs inside the discarded subtransaction harness, so the trigger is
-- restored automatically. A passing assertion here means the residual risk is
-- real and therefore has to be answered by the credential split, the runbook
-- and the audit trail -- not by pretending it does not exist.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_was_disabled boolean := false;
BEGIN
  -- Reproduce the risk explicitly, in our own subtransaction, so we can prove
  -- both halves: it works, and it is undone.
  BEGIN
    EXECUTE 'SET LOCAL ROLE directus_migrator';
    EXECUTE 'ALTER TABLE incidents DISABLE TRIGGER incidents_immutable_awareness';
    EXECUTE $q$UPDATE incidents SET awareness_at = '2000-01-01' WHERE ref = 'IMMUT-FIXTURE'$q$;
    v_was_disabled := true;
    RAISE EXCEPTION 'afc_test_support_rollback' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN SQLSTATE 'P0001' THEN NULL;
  END;

  PERFORM test_support.assert_true(v_was_disabled, 'immut',
    'documented residual risk: the table owner can disable the guard and then backdate awareness_at',
    'this is why the migration credential must never be the runtime credential');

  -- Undone by the rollback: the guard is standing again.
  PERFORM test_support.assert_raises('test_table_super',
    $q$UPDATE incidents SET awareness_at = awareness_at - interval '1 hour' WHERE ref = 'IMMUT-FIXTURE'$q$,
    '23001', 'immut', 'after the owner probe, the guard is enabled and rejecting again');

  PERFORM test_support.assert_equals(
    (SELECT count(*)::text FROM incidents WHERE ref = 'IMMUT-FIXTURE' AND awareness_at < now()),
    '0', 'immut', 'the fixture clock origin is still server-set after the probe');
END
$$;