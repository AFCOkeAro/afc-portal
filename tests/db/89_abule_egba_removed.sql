-- tests/db/89_abule_egba_removed.sql
--
-- AFC-582 (parent AFC-581, child of AFC-578). THE ABULE-EGBA REMOVAL
-- CONTRACT.
--
-- Migration 20261020_0024_remove_abule_egba.sql deletes the erroneous
-- ABULE-EGBA sample branch row and nothing else. This suite pins that
-- promise -- the half a crafted HTTP request cannot change:
--
--   89.1  removal     -- ABULE-EGBA absent from branches; the mapped
--                         narrow-lane codes present; totals read 30 and
--                         Z5 reads 4 (pinned in full by suite 93).
--   89.2  rerun       -- re-applying 0002 resurrects ABULE-EGBA (ON
--                         CONFLICT DO NOTHING skips present codes only);
--                         re-applying 0024 after it removes it again,
--                         0029 drops the two non-branch rows, and the 89.1
--                         shape holds.
--
-- What this suite does NOT assert (stated, not missing): the 26-branch
-- seeding (AFC-581 owns that, out of scope here); any correctness claim
-- about any removed row beyond its absence; the HTTP half, which
-- lives in the route layer.
--
-- Owner: migration role (directus_migrator) for DDL probes; the app
-- ceiling is pinned by suites 70/87. Rerunnable: every include is
-- idempotent, every assertion reads current state.

-- ---------------------------------------------------------------------------
-- 89.1  REMOVAL. ABULE-EGBA gone; the mapped branch set remains.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  PERFORM test_support.assert_true(
    (SELECT count(*) FROM branches WHERE code = 'ABULE-EGBA') = 0,
    'abule-egba-removed', 'ABULE-EGBA row absent from branches');

  PERFORM test_support.assert_true(
    (SELECT count(*) FROM branches
      WHERE zone = (SELECT id FROM zones WHERE code = 'LAG-NORTH-Z5')) = 4,
    'abule-egba-removed', 'LAG-NORTH-Z5 holds the four 0028-seeded Ijoko-zone branches');

  PERFORM test_support.assert_true(
    (SELECT count(*) FROM branches
      WHERE code IN ('OKE-ARO', 'LEGUN', 'MATOGUN', 'OLOMOWEWE')) = 4,
    'abule-egba-removed', 'all four remaining branch codes present');

  PERFORM test_support.assert_true(
    (SELECT count(*) FROM branches) = 30,
    'abule-egba-removed', 'thirty branches after the removal plus the 0028 seed');
END $$;

-- ---------------------------------------------------------------------------
-- 89.2  RERUN. 0002 resurrects, 0024 removes again; shape holds.
-- ---------------------------------------------------------------------------
\i services/directus/schema/migrations/20261020_0002_hierarchy.sql

DO $$
BEGIN
  PERFORM test_support.assert_true(
    (SELECT count(*) FROM branches WHERE code = 'ABULE-EGBA') = 1,
    'abule-egba-removed', 'resurrection round-trip: 0002 alone brings ABULE-EGBA back');
END $$;

\i services/directus/schema/migrations/20261020_0024_remove_abule_egba.sql
\i services/directus/schema/migrations/20261020_0029_remove_sango_ota_and_satellite.sql

DO $$
BEGIN
  PERFORM test_support.assert_true(
    (SELECT count(*) FROM branches WHERE code = 'ABULE-EGBA') = 0,
    'abule-egba-removed', 'rerun: 0024 re-applied removes ABULE-EGBA again');
  PERFORM test_support.assert_true(
    (SELECT count(*) FROM branches) = 30,
    'abule-egba-removed', 'rerun: still thirty branches');
  PERFORM test_support.assert_true(
    (SELECT count(*) FROM branches
      WHERE zone = (SELECT id FROM zones WHERE code = 'LAG-NORTH-Z5')) = 4,
    'abule-egba-removed', 'rerun: LAG-NORTH-Z5 still holds the four seeded branches');
END $$;
