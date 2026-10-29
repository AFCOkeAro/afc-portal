-- rollback/20261029_0058_profile_photos.down.sql
--
-- Reversal for 20261029_0058_profile_photos.sql (AFC-864).
--
-- What it destroys, stated plainly:
--   people.photo_file, households.photo_file -- the photo slot references.
--   Refuses while any photo is set: a rolled-back column silently
--   disconnects the portraits the staff uploaded, so a non-empty slot does
--   not roll back.
--
-- What it does NOT destroy: people/households rows (untouched), the
-- Directus file rows themselves (system-owned, Directus-side data), roles,
-- policies, permissions, or any grant on any other column. Where the columns
-- are absent (forward never applied) the script is a no-op with a NOTICE.
--
-- Orphan note: dropping the slot leaves any uploaded file rows in
-- directus_files in place. That is deliberate: file lifecycle belongs to
-- Directus, and deleting user uploads from a schema rollback would destroy
-- data the rollback cannot see.

DO $$
DECLARE
  v_rows integer := 0;
BEGIN
  IF to_regclass('public.people') IS NOT NULL
     AND EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema = 'public' AND table_name = 'people'
                    AND column_name = 'photo_file') THEN
    SELECT count(*) INTO v_rows FROM people WHERE photo_file IS NOT NULL;
  END IF;
  IF v_rows = 0
     AND to_regclass('public.households') IS NOT NULL
     AND EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema = 'public' AND table_name = 'households'
                    AND column_name = 'photo_file') THEN
    SELECT count(*) INTO v_rows FROM households WHERE photo_file IS NOT NULL;
  END IF;

  IF v_rows > 0 THEN
    RAISE EXCEPTION
      'refusing to roll back profile photos: % portrait slot(s) still set. Clear the photos first; an empty slot rolls back, anything else does not.',
      v_rows
      USING ERRCODE = 'restrict_violation';
  END IF;

  RAISE NOTICE 'profile-photos rollback proceeding: no photos set.';
END $$;

ALTER TABLE IF EXISTS people DROP COLUMN IF EXISTS photo_file;
ALTER TABLE IF EXISTS households DROP COLUMN IF EXISTS photo_file;
