-- rollback/20261020_0028_lagos_north_branches.down.sql
--
-- Reversal for 20261020_0028_lagos_north_branches.sql. AFC-578.
--
-- What it does, stated plainly:
--   deletes the 26 seeded branches BY CODE (guarded: refuses loudly while
--   any of them is referenced anywhere — row-grained FK scan, no CASCADE),
--   moves LEGUN/MATOGUN/OLOMOWEWE (and their BSC denorms) back to their
--   0002 zones (Z2/Z3/Z4), and restores LEGUN/OLOMOWEWE to
--   full_fledged/'FFC'. Touches neither ABULE-EGBA (owned by the landed
--   narrow 0024) nor SANGO-OTA (kept per CTO ruling). Idempotent; re-apply
--   0028 to restore the user-mapped 30.

DO $$
DECLARE
  c record;
  v_refs integer;
BEGIN
  FOR c IN
    SELECT kcu.table_schema || '.' || kcu.table_name AS child_table,
           kcu.column_name AS child_column
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu
        ON kcu.constraint_name = tc.constraint_name
       AND kcu.constraint_schema = tc.constraint_schema
      JOIN information_schema.constraint_column_usage ccu
        ON ccu.constraint_name = tc.constraint_name
       AND ccu.constraint_schema = tc.constraint_schema
     WHERE tc.constraint_type = 'FOREIGN KEY'
       AND ccu.table_schema = 'public'
       AND ccu.table_name = 'branches'
       AND ccu.column_name = 'id'
     ORDER BY 1, 2
  LOOP
    EXECUTE format(
      'SELECT count(*) FROM %I.%I WHERE %I IN ('
      'SELECT id FROM public.branches WHERE code IN ('
      '''AKUTE'',''KOYEMIDUN'',''OLAMBE'',''SANGO'',''IJU-OTA'','
      '''NEW-CITY'',''DALEMO'',''IFO'',''COKER'',''PAKOTO'',''AGOSI'','
      '''IBOGUN'',''ITORI'',''ITOKI'',''ABULE-IROKO'',''OKE-OKO'','
      '''ADIYAN'',''ORUDU-AGIRA'',''IJOKO'',''LISA'',''LERIN'',''AGORO'','
      '''AGEGE'',''OJOKORO'',''ADEJOBI'',''KOLAWOLE''))',
      split_part(c.child_table, '.', 1), split_part(c.child_table, '.', 2),
      c.child_column)
      INTO v_refs;
    IF v_refs > 0 THEN
      RAISE EXCEPTION
        'refusing to roll back the branch seed: % row(s) in %.% reference the seeded 26. Migrate the dependents in a reviewed step first.',
        v_refs, c.child_table, c.child_column
        USING ERRCODE = 'restrict_violation';
    END IF;
  END LOOP;
END
$$;

DELETE FROM branches WHERE code IN (
  'AKUTE','KOYEMIDUN','OLAMBE','SANGO','IJU-OTA','NEW-CITY','DALEMO',
  'IFO','COKER','PAKOTO','AGOSI','IBOGUN','ITORI','ITOKI','ABULE-IROKO',
  'OKE-OKO','ADIYAN','ORUDU-AGIRA','IJOKO','LISA','LERIN','AGORO',
  'AGEGE','OJOKORO','ADEJOBI','KOLAWOLE');

UPDATE branches SET zone = (SELECT id FROM zones WHERE code = 'LAG-NORTH-Z2')
 WHERE code = 'LEGUN'
   AND zone IS DISTINCT FROM (SELECT id FROM zones WHERE code = 'LAG-NORTH-Z2');
UPDATE branches SET zone = (SELECT id FROM zones WHERE code = 'LAG-NORTH-Z3')
 WHERE code = 'MATOGUN'
   AND zone IS DISTINCT FROM (SELECT id FROM zones WHERE code = 'LAG-NORTH-Z3');
UPDATE branches SET zone = (SELECT id FROM zones WHERE code = 'LAG-NORTH-Z4')
 WHERE code = 'OLOMOWEWE'
   AND zone IS DISTINCT FROM (SELECT id FROM zones WHERE code = 'LAG-NORTH-Z4');

UPDATE bible_study_centres SET zone = (SELECT id FROM zones WHERE code = 'LAG-NORTH-Z2')
 WHERE parent_branch = (SELECT id FROM branches WHERE code = 'LEGUN')
   AND zone IS DISTINCT FROM (SELECT id FROM zones WHERE code = 'LAG-NORTH-Z2');
UPDATE bible_study_centres SET zone = (SELECT id FROM zones WHERE code = 'LAG-NORTH-Z3')
 WHERE parent_branch = (SELECT id FROM branches WHERE code = 'MATOGUN')
   AND zone IS DISTINCT FROM (SELECT id FROM zones WHERE code = 'LAG-NORTH-Z3');
UPDATE bible_study_centres SET zone = (SELECT id FROM zones WHERE code = 'LAG-NORTH-Z4')
 WHERE parent_branch = (SELECT id FROM branches WHERE code = 'OLOMOWEWE')
   AND zone IS DISTINCT FROM (SELECT id FROM zones WHERE code = 'LAG-NORTH-Z4');

UPDATE branches SET branch_type = 'full_fledged', type_label = 'FFC'
 WHERE code = 'LEGUN'
   AND (branch_type IS DISTINCT FROM 'full_fledged' OR type_label IS DISTINCT FROM 'FFC');
UPDATE branches SET branch_type = 'full_fledged', type_label = 'FFC'
 WHERE code = 'OLOMOWEWE'
   AND (branch_type IS DISTINCT FROM 'full_fledged' OR type_label IS DISTINCT FROM 'FFC');
