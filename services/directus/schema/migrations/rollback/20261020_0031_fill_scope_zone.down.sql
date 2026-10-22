-- Mirrors the up-script table list (AFC-698): departments carries no
-- afc_fill_scope trigger (0027 single-level scope), so there is nothing to
-- drop there; the IF EXISTS guard makes this a no-op on such tables either
-- way.
DO $$
DECLARE
  t text;
  tables text[] := ARRAY[
    'announcements','attendance_sessions','blessings','campaigns',
    'campus_students','celebrations','coaching_programmes','conference_centres',
    'event_invites','event_referrals','households',
    'marriage_matters','office_minutes','prior_year_import_items',
    'sunday_school_classes','sunday_services','tasks','youth_profiles'
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS afc_fill_scope ON %I', t);
  END LOOP;
END
$$;
DROP FUNCTION IF EXISTS afc_fill_scope_zone();
