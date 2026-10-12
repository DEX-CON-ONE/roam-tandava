-- Booking confirmation emails for bookings made with a membership or class pack.
--
-- `book_class` inserts the booking straight from the browser session, so no
-- Edge Function sees it. This trigger asks the `booking-notifications` Edge
-- Function to send the confirmation, through pg_net:
--
--   * pg_net only queues the request; it is sent by a background worker after
--     the booking's transaction commits, so it can not slow down, block or
--     roll back a booking. Any error while queueing is caught and downgraded
--     to a warning.
--   * The function URL and its shared secret are read from Supabase Vault
--     (`booking_notifications_url`, `booking_notifications_secret`). Nothing
--     secret is in this file. Until both exist the trigger does nothing, so
--     this migration is inert on a project that has not been configured.
--   * Drop-in bookings created by the Stripe webhook carry a `transaction_id`
--     and already get a confirmation from the payment path: they are excluded.
--   * Waitlisted bookings are excluded (status is not `confirmed`).

CREATE EXTENSION IF NOT EXISTS pg_net;

-- Once per booking and kind of email: the Edge Function claims a send by
-- inserting the delivery row first, and a second attempt hits this index.
CREATE UNIQUE INDEX IF NOT EXISTS idx_notification_deliveries_booking_email_once
  ON notification_deliveries (related_entity_id, notification_type)
  WHERE related_entity_type = 'booking' AND channel = 'email';

CREATE OR REPLACE FUNCTION notify_booking_confirmed()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_url TEXT;
  v_secret TEXT;
BEGIN
  BEGIN
    SELECT decrypted_secret INTO v_url FROM vault.decrypted_secrets WHERE name = 'booking_notifications_url';
    SELECT decrypted_secret INTO v_secret FROM vault.decrypted_secrets WHERE name = 'booking_notifications_secret';
    IF COALESCE(v_url, '') = '' OR COALESCE(v_secret, '') = '' THEN
      RETURN NEW;
    END IF;

    PERFORM net.http_post(
      url := v_url,
      body := jsonb_build_object('booking_id', NEW.id),
      headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_secret),
      timeout_milliseconds := 10000
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'booking confirmation not queued for %: %', NEW.id, SQLERRM;
  END;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION notify_booking_confirmed() FROM PUBLIC;
REVOKE ALL ON FUNCTION notify_booking_confirmed() FROM anon, authenticated;

DROP TRIGGER IF EXISTS bookings_notify_confirmed ON bookings;
CREATE TRIGGER bookings_notify_confirmed
  AFTER INSERT ON bookings
  FOR EACH ROW
  WHEN (NEW.status = 'confirmed' AND NEW.transaction_id IS NULL)
  EXECUTE FUNCTION notify_booking_confirmed();

COMMENT ON FUNCTION notify_booking_confirmed() IS
  'Queues a pg_net call to the booking-notifications Edge Function for a new confirmed, non-checkout booking. No-op until the Vault secrets booking_notifications_url and booking_notifications_secret exist.';
