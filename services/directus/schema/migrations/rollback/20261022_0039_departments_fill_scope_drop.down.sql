-- Rollback for 20261022_0039_departments_fill_scope_drop (AFC-676).
--
-- Restores exactly what the up migration removed: the afc_fill_scope trigger
-- on departments. Re-runnable: drop-if-exists guarded.
DROP TRIGGER IF EXISTS afc_fill_scope ON departments;
CREATE TRIGGER afc_fill_scope BEFORE INSERT OR UPDATE OF branch ON departments
FOR EACH ROW EXECUTE FUNCTION afc_fill_scope_zone();
