-- 20261127_0074_ticket_email_sent_at.sql
--
-- AFC-1250: one-send guard for the Flow-triggered ticket email.
--
-- The Directus Flow calls the portal's /api/tickets/flow-send route after the
-- ticket_code is assigned. That route records `ticket_email_sent_at` after a
-- successful send and refuses a second send for the same registration id
-- (F1: recipient from the stored row, one send per registration id, no
-- standalone resend endpoint).
--
-- The column is internal: the writer policy does not include it (public
-- creates cannot set it), and it carries no PII. Directus needs a
-- directus_fields row to expose it to the server-token PATCH; the row is
-- hidden in the admin UI but writable by the server token.
--
-- Guarded: on a database where the collection or Directus system tables do
-- not exist, skip loudly instead of failing a boot.

DO $$
BEGIN
  IF to_regclass('public.event_registrations') IS NULL THEN
    RAISE NOTICE
      'Skipping 20261127_0074: event_registrations not present on this database.';
    RETURN;
  END IF;

  ALTER TABLE event_registrations
    ADD COLUMN IF NOT EXISTS ticket_email_sent_at timestamptz;

  COMMENT ON COLUMN event_registrations.ticket_email_sent_at IS
    'AFC-1250: server-stamped after the Flow-triggered ticket email is sent. NULL = not sent. Not in the public or writer allowlists.';

  IF to_regclass('public.directus_fields') IS NULL THEN
    RAISE NOTICE
      '20261127_0074: column added; directus_fields absent so no field metadata registered.';
    RETURN;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM directus_fields
     WHERE collection = 'event_registrations'
       AND field = 'ticket_email_sent_at'
  ) THEN
    INSERT INTO directus_fields
      (collection, field, special, interface, options, display, display_options,
       readonly, hidden, sort, width, translations, note, conditions, required,
       "group", validation, validation_message, searchable)
    VALUES
      ('event_registrations', 'ticket_email_sent_at', NULL, 'datetime', NULL, NULL, NULL,
       false, true, 29, 'full', NULL,
       'Internal: server-stamped after the ticket email is sent (AFC-1250).',
       NULL, false, NULL, NULL, NULL, false);
    RAISE NOTICE
      '20261127_0074 applied: registered event_registrations.ticket_email_sent_at.';
  ELSE
    RAISE NOTICE
      '20261127_0074 already applied: event_registrations.ticket_email_sent_at is registered.';
  END IF;
END
$$;
