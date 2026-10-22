-- Migration 0031: fill child zone from branch for scope-denormalised tables.
--
-- Migration 0030 attached afc_set_scope to 26 child tables, copying branch and
-- zone from a parent row. A number of top-level tables already carry branch and
-- zone (celebrations, campaigns, ...) and were not covered, so rows created with
-- only a branch kept zone NULL. Zone-scoped policies filter on zone, which made
-- those rows invisible to zone admins. This trigger only fills a missing zone
-- from the branch and never overwrites an explicitly supplied value.

CREATE OR REPLACE FUNCTION afc_fill_scope_zone() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  p_zone uuid;
BEGIN
  IF NEW.zone IS NULL AND NEW.branch IS NOT NULL THEN
    SELECT zone INTO p_zone FROM branches WHERE id = NEW.branch;
    NEW.zone := p_zone;
  END IF;
  RETURN NEW;
END
$$;

DO $$
DECLARE
  t text;
  tables text[] := ARRAY[
    'announcements','attendance_sessions','blessings','campaigns',
    'campus_students','celebrations','coaching_programmes','conference_centres',
    'departments','event_invites','event_referrals','households',
    'marriage_matters','office_minutes','prior_year_import_items',
    'sunday_school_classes','sunday_services','tasks','youth_profiles'
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    EXECUTE format('UPDATE %I x SET zone = b.zone FROM branches b WHERE x.zone IS NULL AND x.branch = b.id', t);
    EXECUTE format('DROP TRIGGER IF EXISTS afc_fill_scope ON %I', t);
    EXECUTE format('CREATE TRIGGER afc_fill_scope BEFORE INSERT OR UPDATE OF branch ON %I FOR EACH ROW EXECUTE FUNCTION afc_fill_scope_zone()', t);
  END LOOP;
END
$$;
