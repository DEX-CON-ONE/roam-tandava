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

SELECT 'PASS: RLS isolation, booking, capacity, double-booking, cancellation window, waitlist promotion, and entitlement consistency' AS result;
ROLLBACK;
