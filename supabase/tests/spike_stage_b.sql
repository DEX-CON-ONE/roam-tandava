-- Stage B local validation fixture. Run through spike_stage_b.sh; do not run
-- this file against a hosted project.
-- The harness uses Postgres's request.jwt.claim.sub to exercise the same auth.uid()
-- path used by Supabase clients, with two isolated studios and three members.

BEGIN;

CREATE TEMP TABLE spike_ids (
  studio_a UUID,
  studio_b UUID,
  owner_a UUID,
  member_a UUID,
  member_b UUID,
  member_b_other_studio UUID,
  location_a UUID,
  offering_a UUID,
  occurrence_a UUID,
  occurrence_late UUID,
  membership_a UUID,
  pack_a UUID,
  booking_a UUID,
  booking_late UUID
) ON COMMIT DROP;

CREATE OR REPLACE FUNCTION spike_assert(condition BOOLEAN, message TEXT)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF NOT condition THEN RAISE EXCEPTION 'SPIKE FAIL: %', message; END IF;
END;
$$;

CREATE OR REPLACE FUNCTION spike_as(uid UUID)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claim.sub', uid::TEXT, TRUE);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', TRUE);
END;
$$;

INSERT INTO studios (name, slug, discoverable, default_cancellation_minutes)
VALUES ('Spike Studio A', 'spike-a', TRUE, 120), ('Spike Studio B', 'spike-b', FALSE, 120);

INSERT INTO auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
SELECT id, email, crypt('spike-password', gen_salt('bf')), NOW(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb
FROM (VALUES
  (gen_random_uuid(), 'owner-a@example.test'),
  (gen_random_uuid(), 'member-a@example.test'),
  (gen_random_uuid(), 'member-b@example.test'),
  (gen_random_uuid(), 'member-other@example.test')
) AS users(id, email);

DELETE FROM profiles
WHERE id IN (SELECT id FROM auth.users WHERE email LIKE '%@example.test');

INSERT INTO profiles (id, email, first_name, last_name)
VALUES
  ((SELECT id FROM auth.users WHERE email = 'owner-a@example.test'), 'owner-a@example.test', 'Owner', 'A'),
  ((SELECT id FROM auth.users WHERE email = 'member-a@example.test'), 'member-a@example.test', 'Member', 'A'),
  ((SELECT id FROM auth.users WHERE email = 'member-b@example.test'), 'member-b@example.test', 'Member', 'B'),
  ((SELECT id FROM auth.users WHERE email = 'member-other@example.test'), 'member-other@example.test', 'Member', 'Other');

INSERT INTO spike_ids (studio_a, studio_b, owner_a, member_a, member_b, member_b_other_studio)
SELECT
  (SELECT id FROM studios WHERE slug = 'spike-a'),
  (SELECT id FROM studios WHERE slug = 'spike-b'),
  (SELECT id FROM profiles WHERE email = 'owner-a@example.test'),
  (SELECT id FROM profiles WHERE email = 'member-a@example.test'),
  (SELECT id FROM profiles WHERE email = 'member-b@example.test'),
  (SELECT id FROM profiles WHERE email = 'member-other@example.test');

INSERT INTO studio_staff (studio_id, profile_id, role)
SELECT studio_a, owner_a, 'owner' FROM spike_ids;
INSERT INTO studio_members (studio_id, profile_id)
SELECT studio_a, member_a FROM spike_ids
UNION ALL SELECT studio_a, member_b FROM spike_ids
UNION ALL SELECT studio_b, member_b_other_studio FROM spike_ids;

INSERT INTO locations (studio_id, name)
SELECT studio_a, 'Main Room' FROM spike_ids;
INSERT INTO offerings (studio_id, name, slug, duration_minutes, capacity)
SELECT studio_a, 'UNDEFEATED', 'undefeated', 60, 1 FROM spike_ids;

UPDATE spike_ids SET location_a = (SELECT id FROM locations WHERE studio_id = studio_a AND name = 'Main Room'), offering_a = (SELECT id FROM offerings WHERE studio_id = studio_a AND slug = 'undefeated');

INSERT INTO class_occurrences (studio_id, offering_id, location_id, starts_at, ends_at, capacity)
SELECT studio_a, offering_a, location_a, NOW() + INTERVAL '7 days', NOW() + INTERVAL '7 days 1 hour', 1 FROM spike_ids
;
INSERT INTO class_occurrences (studio_id, offering_id, location_id, starts_at, ends_at, capacity)
SELECT studio_a, offering_a, location_a, NOW() + INTERVAL '15 minutes', NOW() + INTERVAL '75 minutes', 1 FROM spike_ids
;
UPDATE spike_ids SET occurrence_a = (SELECT id FROM class_occurrences WHERE studio_id = spike_ids.studio_a AND starts_at > NOW() + INTERVAL '6 days'), occurrence_late = (SELECT id FROM class_occurrences WHERE studio_id = spike_ids.studio_a AND starts_at < NOW() + INTERVAL '1 hour');

INSERT INTO membership_types (studio_id, name, price_cents, classes_per_cycle)
SELECT studio_a, 'Unlimited-ish spike membership', 0, 2 FROM spike_ids;
INSERT INTO memberships (studio_id, profile_id, membership_type_id, current_period_start, current_period_end)
SELECT studio_a, member_a, (SELECT id FROM membership_types WHERE membership_types.studio_id = spike_ids.studio_a AND name = 'Unlimited-ish spike membership'), NOW() - INTERVAL '1 day', NOW() + INTERVAL '30 days' FROM spike_ids;
UPDATE spike_ids SET membership_a = (SELECT id FROM memberships WHERE memberships.profile_id = spike_ids.member_a AND memberships.studio_id = spike_ids.studio_a);

INSERT INTO class_pack_types (studio_id, name, class_count, price_cents, validity_days)
SELECT studio_a, 'Two class pack', 2, 0, 30 FROM spike_ids;
INSERT INTO class_packs (studio_id, profile_id, class_pack_type_id, classes_remaining, classes_total, expires_at)
SELECT studio_a, member_b, (SELECT id FROM class_pack_types WHERE class_pack_types.studio_id = spike_ids.studio_a AND name = 'Two class pack'), 2, 2, NOW() + INTERVAL '30 days' FROM spike_ids;
UPDATE spike_ids SET pack_a = (SELECT id FROM class_packs WHERE class_packs.profile_id = spike_ids.member_b AND class_packs.studio_id = spike_ids.studio_a);

-- RLS isolation in both directions: A member sees neither B's private rows nor B's booking data.
SELECT spike_as(member_a) FROM spike_ids;
SELECT spike_assert((SELECT COUNT(*) FROM studios WHERE id = (SELECT studio_b FROM spike_ids) AND discoverable = FALSE AND id IN (SELECT studio_id FROM studio_members WHERE profile_id = auth.uid())) = 0, 'private studio B leaked to studio A member');
SELECT spike_assert((SELECT COUNT(*) FROM class_occurrences WHERE studio_id = (SELECT studio_b FROM spike_ids)) = 0, 'studio B schedule leaked to studio A member');
SELECT spike_assert((SELECT COUNT(*) FROM studio_members WHERE studio_id = (SELECT studio_b FROM spike_ids) AND profile_id = (SELECT member_b_other_studio FROM spike_ids) AND profile_id = auth.uid()) = 0, 'studio B members leaked to studio A member');
SELECT spike_assert((SELECT COUNT(*) FROM bookings WHERE studio_id = (SELECT studio_b FROM spike_ids)) = 0, 'studio B bookings leaked to studio A member');

SELECT spike_as(member_b_other_studio) FROM spike_ids;
SELECT spike_assert((SELECT COUNT(*) FROM studios WHERE id = (SELECT studio_a FROM spike_ids) AND discoverable = FALSE AND id IN (SELECT studio_id FROM studio_members WHERE profile_id = auth.uid())) = 0, 'private studio A leaked to studio B member');
SELECT spike_assert((SELECT COUNT(*) FROM class_occurrences WHERE studio_id = (SELECT studio_a FROM spike_ids) AND studio_id IN (SELECT studio_id FROM studio_members WHERE profile_id = auth.uid())) = 0, 'studio A schedule leaked to studio B member');

-- Book, consume entitlement, and reject a double booking.
SELECT spike_as(member_a) FROM spike_ids;
INSERT INTO bookings (studio_id, class_occurrence_id, profile_id, status, membership_id)
SELECT studio_a, occurrence_a, member_a, 'confirmed', membership_a FROM spike_ids;
UPDATE spike_ids SET booking_a = (SELECT id FROM bookings WHERE profile_id = member_a AND class_occurrence_id = occurrence_a);
SELECT spike_assert((SELECT classes_used_this_cycle FROM memberships WHERE id = (SELECT membership_a FROM spike_ids)) = 1, 'membership was not consumed');
SELECT spike_assert((SELECT booked_count FROM class_occurrences WHERE id = (SELECT occurrence_a FROM spike_ids)) = 1, 'capacity count did not update');

DO $$
BEGIN
  BEGIN
    INSERT INTO bookings (studio_id, class_occurrence_id, profile_id, status, membership_id)
    SELECT studio_a, occurrence_a, member_a, 'confirmed', membership_a FROM spike_ids;
    RAISE EXCEPTION 'SPIKE FAIL: duplicate booking was accepted';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;
END $$;

-- A second member is waitlisted at capacity and does not consume their pack.
INSERT INTO bookings (studio_id, class_occurrence_id, profile_id, status, class_pack_id, waitlist_position)
SELECT studio_a, occurrence_a, member_b, 'waitlisted', pack_a, 1 FROM spike_ids;
SELECT spike_assert((SELECT classes_remaining FROM class_packs WHERE id = (SELECT pack_a FROM spike_ids)) = 2, 'waitlisted booking consumed a pack');
SELECT spike_assert((SELECT status FROM bookings WHERE class_occurrence_id = (SELECT occurrence_a FROM spike_ids) AND profile_id = (SELECT member_b FROM spike_ids)) = 'waitlisted', 'capacity did not waitlist');

-- On-time cancel refunds the membership entitlement and promotes the waitlist.
SELECT cancel_booking((SELECT booking_a FROM spike_ids));
SELECT spike_assert((SELECT classes_used_this_cycle FROM memberships WHERE id = (SELECT membership_a FROM spike_ids)) = 0, 'on-time cancellation did not refund membership');
SELECT spike_assert((SELECT status FROM bookings WHERE class_occurrence_id = (SELECT occurrence_a FROM spike_ids) AND profile_id = (SELECT member_b FROM spike_ids)) = 'confirmed', 'waitlist was not promoted');
SELECT spike_assert((SELECT classes_remaining FROM class_packs WHERE id = (SELECT pack_a FROM spike_ids)) = 1, 'promotion did not consume pack');

-- Late cancellation keeps the entitlement consumed and creates the fee only when configured.
UPDATE studios SET late_cancel_fee_cents = 500 WHERE id = (SELECT studio_a FROM spike_ids);
INSERT INTO bookings (studio_id, class_occurrence_id, profile_id, status, membership_id)
SELECT studio_a, occurrence_late, member_a, 'confirmed', membership_a FROM spike_ids;
SELECT cancel_booking((SELECT id FROM bookings WHERE profile_id = (SELECT member_a FROM spike_ids) AND class_occurrence_id = (SELECT occurrence_late FROM spike_ids)));
SELECT spike_assert((SELECT classes_used_this_cycle FROM memberships WHERE id = (SELECT membership_a FROM spike_ids)) = 1, 'late cancellation incorrectly refunded membership');
SELECT spike_assert((SELECT COUNT(*) FROM transactions WHERE booking_id = (SELECT id FROM bookings WHERE profile_id = (SELECT member_a FROM spike_ids) AND class_occurrence_id = (SELECT occurrence_late FROM spike_ids)) AND type = 'late_cancel_fee' AND amount_cents = 500) = 1, 'late cancellation fee missing');

-- Stripe webhook delivery is idempotent and service-role only.
SELECT set_config('role', 'service_role', TRUE);
INSERT INTO stripe_webhook_events (id, type) VALUES ('evt_spike', 'checkout.session.completed');
DO $$
BEGIN
  BEGIN
    INSERT INTO stripe_webhook_events (id, type) VALUES ('evt_spike', 'checkout.session.completed');
    RAISE EXCEPTION 'SPIKE FAIL: duplicate Stripe event insert did not raise unique_violation';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;
END $$;
SELECT spike_assert((SELECT COUNT(*) FROM stripe_webhook_events WHERE id = 'evt_spike') = 1, 'duplicate Stripe event was recorded');

SELECT set_config('role', 'authenticated', TRUE);
SELECT spike_assert((SELECT COUNT(*) FROM stripe_webhook_events) = 0, 'authenticated role can read Stripe event ledger');
DO $$
BEGIN
  BEGIN
    INSERT INTO stripe_webhook_events (id, type) VALUES ('evt_forbidden', 'checkout.session.completed');
    RAISE EXCEPTION 'SPIKE FAIL: authenticated role can write Stripe event ledger';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;

-- Profile creation trigger (00022): names for password and OAuth sign-ups.
RESET ROLE;
INSERT INTO auth.users (id, email, raw_app_meta_data, raw_user_meta_data)
VALUES
  (gen_random_uuid(), 'password@signup.example.test', '{"provider":"email"}'::jsonb, '{"first_name":"Sam","last_name":"Lee","marketing_consent":true}'::jsonb),
  (gen_random_uuid(), 'firstonly@signup.example.test', '{"provider":"email"}'::jsonb, '{"first_name":"Cher","last_name":"","full_name":"Ignored Name"}'::jsonb),
  (gen_random_uuid(), 'given@signup.example.test', '{"provider":"google"}'::jsonb, '{"given_name":"Priya","family_name":"Shah","full_name":"Priya K Shah","name":"Priya K Shah"}'::jsonb),
  (gen_random_uuid(), 'fullname@signup.example.test', '{"provider":"google"}'::jsonb, '{"full_name":"  Mary  Jane   van der Berg ","name":"Other"}'::jsonb),
  (gen_random_uuid(), 'nameonly@signup.example.test', '{"provider":"google"}'::jsonb, '{"name":"Madonna"}'::jsonb),
  (gen_random_uuid(), 'nometa@signup.example.test', '{"provider":"google"}'::jsonb, '{}'::jsonb),
  (gen_random_uuid(), 'nullmeta@signup.example.test', '{"provider":"google"}'::jsonb, NULL);

SELECT spike_assert((SELECT COUNT(*) FROM profiles WHERE email LIKE '%@signup.example.test') = 7, 'a profile row was not created for every new auth user');
SELECT spike_assert((SELECT (first_name, last_name) = ('Sam', 'Lee') FROM profiles WHERE email = 'password@signup.example.test'), 'password sign-up names changed');
SELECT spike_assert((SELECT (first_name, last_name) = ('Cher', '') FROM profiles WHERE email = 'firstonly@signup.example.test'), 'explicit first_name must win over full_name');
SELECT spike_assert((SELECT (first_name, last_name) = ('Priya', 'Shah') FROM profiles WHERE email = 'given@signup.example.test'), 'given_name/family_name not used for OAuth sign-up');
SELECT spike_assert((SELECT (first_name, last_name) = ('Mary', 'Jane van der Berg') FROM profiles WHERE email = 'fullname@signup.example.test'), 'full_name not split into first/last');
SELECT spike_assert((SELECT (first_name, last_name) = ('Madonna', '') FROM profiles WHERE email = 'nameonly@signup.example.test'), 'single-word name not handled');
SELECT spike_assert((SELECT (first_name, last_name) = ('', '') FROM profiles WHERE email = 'nometa@signup.example.test'), 'empty metadata should give empty names');
SELECT spike_assert((SELECT (first_name, last_name) = ('', '') FROM profiles WHERE email = 'nullmeta@signup.example.test'), 'null metadata should give empty names');

-- A later change to the auth user (e.g. linking Google) must not overwrite a name the user set.
UPDATE profiles SET first_name = 'Samantha' WHERE email = 'password@signup.example.test';
UPDATE auth.users SET raw_user_meta_data = '{"full_name":"Someone Else","given_name":"Someone","family_name":"Else"}'::jsonb WHERE email = 'password@signup.example.test';
SELECT spike_assert((SELECT (first_name, last_name) = ('Samantha', 'Lee') FROM profiles WHERE email = 'password@signup.example.test'), 'profile name was overwritten by an auth metadata update');

-- The Auth service runs with search_path = auth; the trigger must still find public.profiles.
SET LOCAL search_path = auth;
INSERT INTO auth.users (id, email, raw_app_meta_data, raw_user_meta_data)
VALUES (gen_random_uuid(), 'authpath@signup.example.test', '{"provider":"email"}'::jsonb, '{"first_name":"Path","last_name":"Check"}'::jsonb);
SET LOCAL search_path = "$user", public, extensions;
SELECT spike_assert((SELECT (first_name, last_name) = ('Path', 'Check') FROM profiles WHERE email = 'authpath@signup.example.test'), 'profile not created when the caller search_path is auth');

-- Booking confirmation trigger (00023): queues a pg_net call once Vault is configured,
-- only for confirmed bookings that did not come from Stripe Checkout.
SELECT spike_assert(EXISTS (
  SELECT 1 FROM pg_trigger WHERE tgname = 'bookings_notify_confirmed' AND tgrelid = 'public.bookings'::regclass AND NOT tgisinternal
), 'bookings_notify_confirmed trigger is missing');
SELECT spike_assert((SELECT COUNT(*) FROM net.http_request_queue) = 0, 'a request was queued although Vault is not configured');

SELECT vault.create_secret('https://functions.example.test/functions/v1/booking-notifications', 'booking_notifications_url');
SELECT vault.create_secret('spike-shared-secret', 'booking_notifications_secret');

CREATE TEMP TABLE spike_notify (n INT PRIMARY KEY, occurrence UUID, booking UUID) ON COMMIT DROP;
WITH created AS (
  INSERT INTO class_occurrences (studio_id, offering_id, location_id, starts_at, ends_at, capacity)
  SELECT o.studio_id, o.offering_id, o.location_id,
         o.starts_at + make_interval(days => 30 + n), o.ends_at + make_interval(days => 30 + n), 20
  FROM class_occurrences o, generate_series(1, 3) AS n
  WHERE o.id = (SELECT occurrence_a FROM spike_ids)
  RETURNING id, starts_at
)
INSERT INTO spike_notify (n, occurrence)
SELECT ROW_NUMBER() OVER (ORDER BY starts_at), id FROM created;

-- 1. Confirmed booking with no checkout transaction (membership / class pack path): queued.
INSERT INTO bookings (studio_id, class_occurrence_id, profile_id, status)
SELECT studio_a, (SELECT occurrence FROM spike_notify WHERE n = 1), member_a, 'confirmed' FROM spike_ids;
UPDATE spike_notify SET booking = (SELECT id FROM bookings WHERE class_occurrence_id = spike_notify.occurrence) WHERE n = 1;
SELECT spike_assert((SELECT COUNT(*) FROM net.http_request_queue) = 1, 'confirmed booking did not queue exactly one notification request');
SELECT spike_assert((
  SELECT q.url = 'https://functions.example.test/functions/v1/booking-notifications'
     AND q.headers->>'Authorization' = 'Bearer spike-shared-secret'
     AND (convert_from(q.body, 'UTF8')::jsonb->>'booking_id')::uuid = (SELECT booking FROM spike_notify WHERE n = 1)
  FROM net.http_request_queue q
), 'queued request does not carry the Vault URL, the shared secret and the booking id');

-- 2. Waitlisted booking: not queued.
INSERT INTO bookings (studio_id, class_occurrence_id, profile_id, status, waitlist_position)
SELECT studio_a, (SELECT occurrence FROM spike_notify WHERE n = 2), member_a, 'waitlisted', 1 FROM spike_ids;
-- 3. Drop-in booking created by the Stripe webhook (has a transaction): not queued here.
INSERT INTO bookings (studio_id, class_occurrence_id, profile_id, status, transaction_id)
SELECT studio_a, (SELECT occurrence FROM spike_notify WHERE n = 3), member_a, 'confirmed', gen_random_uuid() FROM spike_ids;
SELECT spike_assert((SELECT COUNT(*) FROM net.http_request_queue) = 1, 'a waitlisted or checkout booking queued a notification request');

-- The delivery log allows one email of each kind per booking.
INSERT INTO notification_deliveries (studio_id, notification_type, channel, body, related_entity_type, related_entity_id)
SELECT studio_a, 'booking_confirmation', 'email', 'spike', 'booking', (SELECT booking FROM spike_notify WHERE n = 1) FROM spike_ids;
INSERT INTO notification_deliveries (studio_id, notification_type, channel, body, related_entity_type, related_entity_id)
SELECT studio_a, 'studio_booking_notification', 'email', 'spike', 'booking', (SELECT booking FROM spike_notify WHERE n = 1) FROM spike_ids;
DO $$
BEGIN
  BEGIN
    INSERT INTO notification_deliveries (studio_id, notification_type, channel, body, related_entity_type, related_entity_id)
    SELECT studio_a, 'booking_confirmation', 'email', 'spike again', 'booking', (SELECT booking FROM spike_notify WHERE n = 1) FROM spike_ids;
    RAISE EXCEPTION 'SPIKE FAIL: a second booking confirmation could be claimed for the same booking';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;
END $$;

-- book_class() (00030): a pass booking consumes exactly one class, and a member can
-- book the same class again after cancelling.
RESET ROLE;
CREATE TEMP TABLE spike_rpc (occurrence UUID, pack UUID, before_remaining INT, booking UUID) ON COMMIT DROP;
WITH created AS (
  INSERT INTO class_occurrences (studio_id, offering_id, location_id, starts_at, ends_at, capacity)
  SELECT o.studio_id, o.offering_id, o.location_id, o.starts_at + make_interval(days => 60), o.ends_at + make_interval(days => 60), 20
  FROM class_occurrences o WHERE o.id = (SELECT occurrence_a FROM spike_ids)
  RETURNING id
), pack AS (
  INSERT INTO class_packs (studio_id, profile_id, class_pack_type_id, status, classes_remaining, classes_total, expires_at)
  SELECT cp.studio_id, cp.profile_id, cp.class_pack_type_id, 'active', 5, 5, NOW() + INTERVAL '30 days'
  FROM class_packs cp WHERE cp.id = (SELECT pack_a FROM spike_ids)
  RETURNING id, profile_id
)
INSERT INTO spike_rpc (occurrence, pack, before_remaining) SELECT (SELECT id FROM created), (SELECT id FROM pack), 5;
SELECT spike_as((SELECT profile_id FROM class_packs WHERE id = (SELECT pack FROM spike_rpc)));
UPDATE spike_rpc SET booking = (book_class((SELECT occurrence FROM spike_rpc), 'class_pack', (SELECT pack FROM spike_rpc))).id;
SELECT spike_assert((SELECT classes_remaining FROM class_packs WHERE id = (SELECT pack FROM spike_rpc)) = 4, 'book_class did not consume exactly one class from the pack');
SELECT cancel_booking((SELECT booking FROM spike_rpc));
SELECT spike_assert((SELECT classes_remaining FROM class_packs WHERE id = (SELECT pack FROM spike_rpc)) = 5, 'on-time cancel did not return the class to the pack');
SELECT book_class((SELECT occurrence FROM spike_rpc), 'class_pack', (SELECT pack FROM spike_rpc));
SELECT spike_assert((SELECT COUNT(*) FROM bookings WHERE class_occurrence_id = (SELECT occurrence FROM spike_rpc) AND status = 'confirmed') = 1, 'could not book the same class again after cancelling');
SELECT spike_assert((SELECT classes_remaining FROM class_packs WHERE id = (SELECT pack FROM spike_rpc)) = 4, 're-booking did not consume exactly one class');
SELECT spike_assert(jsonb_array_length((get_booking_options((SELECT occurrence FROM spike_rpc)))->'sources') >= 1, 'get_booking_options returned no passes for the member');
SELECT spike_assert((SELECT COUNT(*) FROM get_my_bookings('spike-a') WHERE occurrence_id = (SELECT occurrence FROM spike_rpc)) = 2, 'get_my_bookings did not return the member''s bookings');
RESET ROLE;

-- Owner admin (00031). Everything above runs as the database owner, which
-- bypasses row level security. These run as the `authenticated` role, the way
-- the API does: a policy that recurses (studio_staff used to) fails here.
RESET ROLE;
GRANT SELECT ON spike_ids TO authenticated;

SELECT spike_as(owner_a) FROM spike_ids;
SET LOCAL ROLE authenticated;
SELECT spike_assert((SELECT COUNT(*) FROM studio_staff) = 1, 'owner cannot read their own staff row through RLS');
SELECT spike_assert((SELECT COUNT(*) FROM profiles WHERE id = auth.uid()) = 1, 'owner cannot read their own profile through RLS');
SELECT spike_assert((SELECT COUNT(*) FROM profiles) = 3, 'owner should see their own profile and the two studio A members');
SELECT spike_assert((SELECT COUNT(*) FROM bookings WHERE studio_id = (SELECT studio_a FROM spike_ids)) > 0, 'owner cannot read studio bookings through RLS');
SELECT spike_assert((manage_my_studio()->>'id')::uuid = (SELECT studio_a FROM spike_ids), 'manage_my_studio did not return the studio of its owner');
INSERT INTO offerings (studio_id, name, slug) SELECT studio_a, 'Owner made', 'owner-made' FROM spike_ids;
UPDATE offerings SET drop_in_price_cents = 1200 WHERE slug = 'owner-made';
SELECT spike_assert((SELECT drop_in_price_cents FROM offerings WHERE slug = 'owner-made') = 1200, 'owner could not price their own class type');
DELETE FROM offerings WHERE slug = 'owner-made';
SELECT spike_assert((SELECT COUNT(*) FROM offerings WHERE slug = 'owner-made') = 1, 'a class type could be deleted through RLS');
DO $$
BEGIN
  BEGIN
    INSERT INTO offerings (studio_id, name, slug) SELECT studio_b, 'Not mine', 'not-mine' FROM spike_ids;
    RAISE EXCEPTION 'SPIKE FAIL: owner of studio A created a class type in studio B';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;
SELECT spike_assert((manage_create_weekly_schedule(
  (SELECT offering_a FROM spike_ids), (SELECT location_a FROM spike_ids), NULL, 'monday', '09:00'
)->>'sessions_created')::int BETWEEN 11 AND 13, 'a weekly schedule did not create about twelve weeks of sessions');
SELECT spike_assert((SELECT COUNT(DISTINCT to_char(starts_at AT TIME ZONE 'America/New_York', 'ID HH24:MI')) FROM class_occurrences WHERE schedule_rule_id IS NOT NULL) = 1, 'weekly sessions are not all on the same weekday and studio-local time');
SELECT spike_assert(manage_top_up_schedules((SELECT studio_a FROM spike_ids)) = 0, 'topping up a full schedule created duplicate sessions');

RESET ROLE;
SELECT spike_as(member_a) FROM spike_ids;
SET LOCAL ROLE authenticated;
SELECT spike_assert((SELECT COUNT(*) FROM studio_staff) = 0, 'a member can read the staff list');
SELECT spike_assert((SELECT COUNT(*) FROM profiles) = 1, 'a member can read the profiles of other people');
SELECT spike_assert(manage_my_studio() IS NULL, 'a member got a studio to manage');
DO $$
BEGIN
  BEGIN
    INSERT INTO offerings (studio_id, name, slug) SELECT studio_a, 'Member made', 'member-made' FROM spike_ids;
    RAISE EXCEPTION 'SPIKE FAIL: a member created a class type';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    PERFORM manage_list_members((SELECT studio_a FROM spike_ids));
    RAISE EXCEPTION 'SPIKE FAIL: a member listed the members of the studio';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    PERFORM manage_cancel_session((SELECT occurrence_a FROM spike_ids));
    RAISE EXCEPTION 'SPIKE FAIL: a member cancelled a session';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    PERFORM create_studio_for_owner(auth.uid(), 'Mine', 'mine');
    RAISE EXCEPTION 'SPIKE FAIL: a signed-in user called create_studio_for_owner';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;
UPDATE offerings SET drop_in_price_cents = 1 WHERE studio_id = (SELECT studio_a FROM spike_ids);
RESET ROLE;
SELECT spike_assert((SELECT COUNT(*) FROM offerings WHERE drop_in_price_cents = 1) = 0, 'a member changed a price');

-- Single-studio mode: off by default (two studios were created above). Once on,
-- no further studio can be created and only an allow-listed, confirmed email may own one.
SELECT spike_assert((SELECT NOT single_studio_mode FROM deployment_settings), 'single-studio mode must be off by default');
UPDATE deployment_settings SET single_studio_mode = TRUE, owner_email_allowlist = ARRAY['Owner-A@Example.test'];
DO $$
BEGIN
  BEGIN
    INSERT INTO studios (name, slug) VALUES ('Third studio', 'spike-c');
    RAISE EXCEPTION 'SPIKE FAIL: a studio was created in single-studio mode while one exists';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    INSERT INTO studio_staff (studio_id, profile_id, role) SELECT studio_b, member_b_other_studio, 'owner' FROM spike_ids;
    RAISE EXCEPTION 'SPIKE FAIL: an account off the allow-list became an owner in single-studio mode';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    PERFORM create_studio_for_owner((SELECT owner_a FROM spike_ids), 'Second', 'second');
    RAISE EXCEPTION 'SPIKE FAIL: the allow-listed owner created a second studio';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;
SELECT spike_assert((studio_setup_access_for((SELECT member_a FROM spike_ids))->>'can_open_setup')::boolean = FALSE, 'a member may open studio setup in single-studio mode');
SELECT spike_assert((studio_setup_access_for((SELECT owner_a FROM spike_ids))->>'can_open_setup')::boolean, 'the owner lost access to studio setup');
-- An allow-listed owner (address matched without regard to case) may be linked as owner.
INSERT INTO studio_staff (studio_id, profile_id, role) SELECT studio_b, owner_a, 'owner' FROM spike_ids;
UPDATE deployment_settings SET single_studio_mode = FALSE, owner_email_allowlist = '{}';

SELECT 'PASS: RLS isolation, booking, capacity, double-booking, cancellation window, waitlist promotion, entitlement consistency, owner admin RLS and single-studio mode' AS result;
ROLLBACK;
