-- Owner (studio admin) backend: what the real /manage screens need.
--
-- 1. RLS fix. "Staff can view co-workers" on studio_staff selects from
--    studio_staff inside its own policy. Postgres rejects that as infinite
--    recursion, and because nearly every other policy sub-selects studio_staff,
--    a signed-in user could not read studios, offerings, bookings, ... at all
--    through the API (only SECURITY DEFINER RPCs worked). Replaced with
--    helper functions that read studio_staff as the definer.
-- 2. Write access for studio managers (owner, admin). Until now no table had
--    an INSERT/UPDATE policy: every write went through a service-role Edge
--    Function. Managers may now add and change their own studio's class
--    types, locations, packs and memberships (no deletes).
-- 3. RPCs for the work that must be atomic or needs the studio's timezone:
--    weekly schedules and sessions, cancelling, staff bookings, attendance,
--    member list and the dashboard.
-- 4. Spot counts: a checked-in (or no-show) booking still holds its spot.
-- 5. Anyone who books or buys becomes a studio member row, so staff can see them.
-- 6. Single-studio mode with an owner allow-list (deployment_settings),
--    enforced by triggers on studios and studio_staff.
--
-- Nothing here inserts business data. Single-studio mode is off by default.

-- ============================================================================
-- 1. Helper functions and the studio_staff policy
-- ============================================================================

CREATE OR REPLACE FUNCTION auth_staff_studio_ids(p_roles user_role[] DEFAULT NULL)
RETURNS SETOF UUID
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT studio_id FROM studio_staff
  WHERE profile_id = auth.uid()
    AND COALESCE(is_active, TRUE)
    AND (p_roles IS NULL OR role = ANY(p_roles));
$$;

CREATE OR REPLACE FUNCTION is_studio_staff(p_studio_id UUID, p_roles user_role[] DEFAULT NULL)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM studio_staff
    WHERE studio_id = p_studio_id
      AND profile_id = auth.uid()
      AND COALESCE(is_active, TRUE)
      AND (p_roles IS NULL OR role = ANY(p_roles))
  );
$$;

CREATE OR REPLACE FUNCTION is_studio_manager(p_studio_id UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT is_studio_staff(p_studio_id, ARRAY['owner', 'admin']::user_role[]);
$$;

DROP POLICY IF EXISTS "Staff can view co-workers" ON studio_staff;
CREATE POLICY "Staff can view co-workers"
  ON studio_staff FOR SELECT
  USING (profile_id = auth.uid() OR is_studio_staff(studio_id));

DROP POLICY IF EXISTS "Staff can view co-worker profiles" ON profiles;
CREATE POLICY "Staff can view co-worker profiles"
  ON profiles FOR SELECT
  USING (
    id IN (
      SELECT ss.profile_id FROM studio_staff ss
      WHERE ss.studio_id IN (SELECT auth_staff_studio_ids())
    )
  );

-- ============================================================================
-- 2. Managers maintain their own studio's catalogue and schedule
-- ============================================================================

-- Insert and update only. Nothing is deleted from the browser: class types,
-- packs and memberships are archived (is_active), and the schedule is changed
-- through the RPCs below so bookings are released properly.
DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['locations', 'offerings', 'membership_types', 'class_pack_types'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS "Managers can add %1$s" ON %1$I', t);
    EXECUTE format('CREATE POLICY "Managers can add %1$s" ON %1$I FOR INSERT WITH CHECK (is_studio_manager(studio_id))', t);
    EXECUTE format('DROP POLICY IF EXISTS "Managers can change %1$s" ON %1$I', t);
    EXECUTE format('CREATE POLICY "Managers can change %1$s" ON %1$I FOR UPDATE USING (is_studio_manager(studio_id)) WITH CHECK (is_studio_manager(studio_id))', t);
  END LOOP;
END $$;

-- ============================================================================
-- 4. Spot counts: checked-in and no-show bookings still hold their spot
-- ============================================================================

CREATE OR REPLACE FUNCTION update_booking_counts()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE class_occurrences SET
    booked_count = (
      SELECT COUNT(*) FROM bookings
      WHERE class_occurrence_id = COALESCE(NEW.class_occurrence_id, OLD.class_occurrence_id)
      AND status IN ('confirmed', 'checked_in', 'no_show')
    ),
    waitlist_count = (
      SELECT COUNT(*) FROM bookings
      WHERE class_occurrence_id = COALESCE(NEW.class_occurrence_id, OLD.class_occurrence_id)
      AND status = 'waitlisted'
    ),
    checked_in_count = (
      SELECT COUNT(*) FROM bookings
      WHERE class_occurrence_id = COALESCE(NEW.class_occurrence_id, OLD.class_occurrence_id)
      AND status = 'checked_in'
    )
  WHERE id = COALESCE(NEW.class_occurrence_id, OLD.class_occurrence_id);
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- ============================================================================
-- 5. Bookers and buyers become studio members
-- ============================================================================

CREATE OR REPLACE FUNCTION ensure_studio_member()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  INSERT INTO studio_members (studio_id, profile_id)
  VALUES (NEW.studio_id, NEW.profile_id)
  ON CONFLICT (studio_id, profile_id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS bookings_ensure_member ON bookings;
CREATE TRIGGER bookings_ensure_member AFTER INSERT ON bookings
  FOR EACH ROW EXECUTE FUNCTION ensure_studio_member();
DROP TRIGGER IF EXISTS class_packs_ensure_member ON class_packs;
CREATE TRIGGER class_packs_ensure_member AFTER INSERT ON class_packs
  FOR EACH ROW EXECUTE FUNCTION ensure_studio_member();
DROP TRIGGER IF EXISTS memberships_ensure_member ON memberships;
CREATE TRIGGER memberships_ensure_member AFTER INSERT ON memberships
  FOR EACH ROW EXECUTE FUNCTION ensure_studio_member();
DROP TRIGGER IF EXISTS transactions_ensure_member ON transactions;
CREATE TRIGGER transactions_ensure_member AFTER INSERT ON transactions
  FOR EACH ROW EXECUTE FUNCTION ensure_studio_member();

-- ============================================================================
-- 6. Single-studio mode and the owner allow-list
-- ============================================================================

CREATE TABLE IF NOT EXISTS deployment_settings (
  id BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (id),
  -- TRUE: this deployment serves exactly one studio.
  single_studio_mode BOOLEAN NOT NULL DEFAULT FALSE,
  -- Sign-in email addresses allowed to create the studio and hold the owner role.
  owner_email_allowlist TEXT[] NOT NULL DEFAULT '{}',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
INSERT INTO deployment_settings (id) VALUES (TRUE) ON CONFLICT (id) DO NOTHING;
ALTER TABLE deployment_settings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON deployment_settings FROM anon, authenticated;

COMMENT ON TABLE deployment_settings IS
  'One row of deployment-level switches. single_studio_mode + owner_email_allowlist close open studio registration. Service role / SQL only.';

CREATE OR REPLACE FUNCTION is_allowlisted_owner(p_profile_id UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM auth.users u, deployment_settings d
    WHERE u.id = p_profile_id
      AND u.email_confirmed_at IS NOT NULL
      AND LOWER(u.email) IN (SELECT LOWER(BTRIM(e)) FROM UNNEST(d.owner_email_allowlist) AS e)
  );
$$;

-- What one account may do with studio setup. Never returns the allow-list.
CREATE OR REPLACE FUNCTION studio_setup_access_for(p_profile_id UUID)
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_single BOOLEAN;
  v_exists BOOLEAN;
  v_owner BOOLEAN;
  v_can_create BOOLEAN;
BEGIN
  SELECT single_studio_mode INTO v_single FROM deployment_settings;
  v_single := COALESCE(v_single, FALSE);
  SELECT EXISTS (SELECT 1 FROM studios) INTO v_exists;
  SELECT EXISTS (
    SELECT 1 FROM studio_staff
    WHERE profile_id = p_profile_id AND role = 'owner' AND COALESCE(is_active, TRUE)
  ) INTO v_owner;

  IF p_profile_id IS NULL THEN
    v_can_create := FALSE;
  ELSIF v_single THEN
    v_can_create := NOT v_exists AND is_allowlisted_owner(p_profile_id);
  ELSE
    v_can_create := NOT v_owner;
  END IF;

  RETURN jsonb_build_object(
    'single_studio_mode', v_single,
    'studio_exists', v_exists,
    'is_owner', v_owner,
    'can_create_studio', v_can_create,
    'can_open_setup', v_owner OR v_can_create
  );
END;
$$;

CREATE OR REPLACE FUNCTION studio_setup_access()
RETURNS JSONB
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT studio_setup_access_for(auth.uid());
$$;

-- The only way a studio is created in single-studio mode: one transaction
-- that checks the caller, creates the studio and links its owner.
CREATE OR REPLACE FUNCTION create_studio_for_owner(
  p_owner_id UUID,
  p_name TEXT,
  p_slug TEXT,
  p_description TEXT DEFAULT NULL,
  p_timezone TEXT DEFAULT NULL,
  p_currency TEXT DEFAULT NULL,
  p_primary_color TEXT DEFAULT NULL,
  p_secondary_color TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_access JSONB;
  v_slug TEXT := NULLIF(BTRIM(p_slug), '');
  v_id UUID;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('create_studio_for_owner'));
  v_access := studio_setup_access_for(p_owner_id);
  IF NOT COALESCE((v_access->>'can_create_studio')::BOOLEAN, FALSE) THEN
    RAISE EXCEPTION 'Studio setup is not available for this account' USING ERRCODE = '42501';
  END IF;

  IF v_slug IS NULL THEN
    v_slug := 'studio';
  END IF;
  IF EXISTS (SELECT 1 FROM studios WHERE slug = v_slug) THEN
    v_slug := v_slug || '-' || SUBSTR(MD5(RANDOM()::TEXT), 1, 4);
  END IF;

  PERFORM set_config('app.studio_creator', p_owner_id::TEXT, TRUE);

  INSERT INTO studios (name, slug, description, timezone, currency, brand_primary_color, brand_secondary_color)
  VALUES (
    COALESCE(NULLIF(BTRIM(p_name), ''), 'My Studio'),
    v_slug,
    p_description,
    COALESCE(NULLIF(p_timezone, ''), 'America/New_York'),
    COALESCE(NULLIF(p_currency, ''), 'USD'),
    COALESCE(NULLIF(p_primary_color, ''), '#4fd1c5'),
    COALESCE(NULLIF(p_secondary_color, ''), '#f687b3')
  )
  RETURNING id INTO v_id;

  INSERT INTO studio_staff (studio_id, profile_id, role) VALUES (v_id, p_owner_id, 'owner');

  -- Single-studio mode: people who registered before the studio existed belong to it.
  IF COALESCE((v_access->>'single_studio_mode')::BOOLEAN, FALSE) THEN
    INSERT INTO studio_members (studio_id, profile_id)
    SELECT v_id, p.id FROM profiles p WHERE p.id <> p_owner_id
    ON CONFLICT (studio_id, profile_id) DO NOTHING;
  END IF;

  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION enforce_single_studio()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_single BOOLEAN;
  v_creator TEXT;
BEGIN
  SELECT single_studio_mode INTO v_single FROM deployment_settings;
  IF NOT COALESCE(v_single, FALSE) THEN
    RETURN NEW;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('enforce_single_studio'));
  IF EXISTS (SELECT 1 FROM studios) THEN
    RAISE EXCEPTION 'Single-studio mode: a studio already exists' USING ERRCODE = '42501';
  END IF;

  v_creator := NULLIF(current_setting('app.studio_creator', TRUE), '');
  IF v_creator IS NULL OR NOT is_allowlisted_owner(v_creator::UUID) THEN
    RAISE EXCEPTION 'Single-studio mode: studios are created by an allow-listed owner through studio setup' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS studios_enforce_single_studio ON studios;
CREATE TRIGGER studios_enforce_single_studio
  BEFORE INSERT ON studios
  FOR EACH ROW EXECUTE FUNCTION enforce_single_studio();

CREATE OR REPLACE FUNCTION enforce_owner_allowlist()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_single BOOLEAN;
BEGIN
  IF NEW.role <> 'owner' THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.role = 'owner' AND OLD.profile_id = NEW.profile_id THEN
    RETURN NEW;
  END IF;
  SELECT single_studio_mode INTO v_single FROM deployment_settings;
  IF COALESCE(v_single, FALSE) AND NOT is_allowlisted_owner(NEW.profile_id) THEN
    RAISE EXCEPTION 'Single-studio mode: this account is not allowed to own the studio' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS studio_staff_enforce_owner_allowlist ON studio_staff;
CREATE TRIGGER studio_staff_enforce_owner_allowlist
  BEFORE INSERT OR UPDATE ON studio_staff
  FOR EACH ROW EXECUTE FUNCTION enforce_owner_allowlist();

-- Single-studio mode: a new sign-up joins the one studio, so the owner sees them.
CREATE OR REPLACE FUNCTION enrol_profile_in_single_studio()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_single BOOLEAN;
BEGIN
  BEGIN
    SELECT single_studio_mode INTO v_single FROM deployment_settings;
    IF COALESCE(v_single, FALSE) AND (SELECT COUNT(*) FROM studios) = 1 THEN
      INSERT INTO studio_members (studio_id, profile_id)
      SELECT s.id, NEW.id FROM studios s
      ON CONFLICT (studio_id, profile_id) DO NOTHING;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'could not enrol profile % in the studio: %', NEW.id, SQLERRM;
  END;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS profiles_enrol_single_studio ON profiles;
CREATE TRIGGER profiles_enrol_single_studio
  AFTER INSERT ON profiles
  FOR EACH ROW EXECUTE FUNCTION enrol_profile_in_single_studio();

-- ============================================================================
-- 3. Schedule: weekly rules, sessions, cancelling
-- ============================================================================

CREATE UNIQUE INDEX IF NOT EXISTS idx_class_occurrences_rule_start
  ON class_occurrences (schedule_rule_id, starts_at)
  WHERE schedule_rule_id IS NOT NULL;

-- Creates the sessions a rule implies, from today (studio time) to p_through.
-- Safe to repeat: an existing session for the same rule and start is kept.
CREATE OR REPLACE FUNCTION generate_rule_occurrences(p_rule_id UUID, p_through DATE)
RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_rule schedule_rules%ROWTYPE;
  v_tz TEXT;
  v_capacity INTEGER;
  v_from DATE;
  v_to DATE;
  v_dow INTEGER;
  v_count INTEGER := 0;
BEGIN
  SELECT * INTO v_rule FROM schedule_rules WHERE id = p_rule_id;
  IF NOT FOUND OR NOT COALESCE(v_rule.is_active, TRUE) THEN
    RETURN 0;
  END IF;
  SELECT timezone INTO v_tz FROM studios WHERE id = v_rule.studio_id;
  SELECT COALESCE(v_rule.capacity_override, capacity) INTO v_capacity FROM offerings WHERE id = v_rule.offering_id;

  v_from := GREATEST(v_rule.effective_from, (NOW() AT TIME ZONE v_tz)::DATE);
  v_to := LEAST(COALESCE(v_rule.effective_until, p_through), p_through);
  IF v_to < v_from THEN
    RETURN 0;
  END IF;
  v_dow := array_position(enum_range(NULL::day_of_week), v_rule.day_of_week);

  INSERT INTO class_occurrences (
    studio_id, offering_id, schedule_rule_id, location_id, teacher_id,
    starts_at, ends_at, room, capacity, instructor_role
  )
  SELECT
    v_rule.studio_id, v_rule.offering_id, v_rule.id, v_rule.location_id, v_rule.teacher_id,
    (d::DATE + v_rule.start_time) AT TIME ZONE v_tz,
    (d::DATE + v_rule.end_time) AT TIME ZONE v_tz,
    v_rule.room, COALESCE(v_capacity, 20), v_rule.instructor_role
  FROM generate_series(v_from::TIMESTAMP, v_to::TIMESTAMP, INTERVAL '1 day') AS d
  WHERE (v_rule.recurrence = 'daily' OR EXTRACT(ISODOW FROM d) = v_dow)
    AND (v_rule.recurrence <> 'biweekly' OR ((d::DATE - v_rule.effective_from) / 7) % 2 = 0)
    AND (v_rule.recurrence <> 'monthly' OR EXTRACT(DAY FROM d) <= 7)
    AND (d::DATE + v_rule.start_time) AT TIME ZONE v_tz > NOW()
  ON CONFLICT (schedule_rule_id, starts_at) WHERE schedule_rule_id IS NOT NULL DO NOTHING;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

-- Checks shared by the schedule RPCs; returns the studio id.
CREATE OR REPLACE FUNCTION manage_check_schedule_refs(p_offering_id UUID, p_location_id UUID, p_teacher_id UUID)
RETURNS UUID
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_studio UUID;
BEGIN
  SELECT studio_id INTO v_studio FROM offerings WHERE id = p_offering_id;
  IF v_studio IS NULL OR NOT is_studio_manager(v_studio) THEN
    RAISE EXCEPTION 'Not allowed to manage this class' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM locations WHERE id = p_location_id AND studio_id = v_studio) THEN
    RAISE EXCEPTION 'Choose a location for this class';
  END IF;
  IF p_teacher_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM studio_staff WHERE studio_id = v_studio AND profile_id = p_teacher_id AND COALESCE(is_active, TRUE)
  ) THEN
    RAISE EXCEPTION 'The coach must be on this studio''s team';
  END IF;
  RETURN v_studio;
END;
$$;

CREATE OR REPLACE FUNCTION manage_create_weekly_schedule(
  p_offering_id UUID,
  p_location_id UUID,
  p_teacher_id UUID,
  p_day day_of_week,
  p_start_time TIME,
  p_effective_from DATE DEFAULT NULL,
  p_effective_until DATE DEFAULT NULL,
  p_capacity INTEGER DEFAULT NULL,
  p_weeks_ahead INTEGER DEFAULT 12
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_studio UUID;
  v_tz TEXT;
  v_duration INTEGER;
  v_end TIME;
  v_today DATE;
  v_rule UUID;
  v_created INTEGER;
BEGIN
  v_studio := manage_check_schedule_refs(p_offering_id, p_location_id, p_teacher_id);
  SELECT timezone INTO v_tz FROM studios WHERE id = v_studio;
  SELECT duration_minutes INTO v_duration FROM offerings WHERE id = p_offering_id;
  v_today := (NOW() AT TIME ZONE v_tz)::DATE;
  v_end := CASE
    WHEN EXTRACT(EPOCH FROM p_start_time) / 60 + v_duration >= 1440 THEN TIME '23:59'
    ELSE p_start_time + make_interval(mins => v_duration)
  END;
  IF p_capacity IS NOT NULL AND p_capacity < 1 THEN
    RAISE EXCEPTION 'Capacity must be at least 1';
  END IF;
  IF p_effective_until IS NOT NULL AND p_effective_until < COALESCE(p_effective_from, v_today) THEN
    RAISE EXCEPTION 'The last date is before the first date';
  END IF;

  INSERT INTO schedule_rules (
    studio_id, offering_id, location_id, teacher_id, recurrence, day_of_week,
    start_time, end_time, capacity_override, effective_from, effective_until
  ) VALUES (
    v_studio, p_offering_id, p_location_id, p_teacher_id, 'weekly', p_day,
    p_start_time, v_end, p_capacity, GREATEST(COALESCE(p_effective_from, v_today), v_today), p_effective_until
  )
  RETURNING id INTO v_rule;

  v_created := generate_rule_occurrences(v_rule, v_today + LEAST(GREATEST(COALESCE(p_weeks_ahead, 12), 1), 26) * 7);
  RETURN jsonb_build_object('rule_id', v_rule, 'sessions_created', v_created);
END;
$$;

CREATE OR REPLACE FUNCTION manage_create_session(
  p_offering_id UUID,
  p_location_id UUID,
  p_teacher_id UUID,
  p_date DATE,
  p_start_time TIME,
  p_capacity INTEGER DEFAULT NULL
)
RETURNS class_occurrences
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_studio UUID;
  v_tz TEXT;
  v_offering offerings%ROWTYPE;
  v_start TIMESTAMPTZ;
  v_row class_occurrences%ROWTYPE;
BEGIN
  v_studio := manage_check_schedule_refs(p_offering_id, p_location_id, p_teacher_id);
  SELECT timezone INTO v_tz FROM studios WHERE id = v_studio;
  SELECT * INTO v_offering FROM offerings WHERE id = p_offering_id;
  v_start := (p_date + p_start_time) AT TIME ZONE v_tz;
  IF v_start <= NOW() THEN
    RAISE EXCEPTION 'Choose a date and time in the future';
  END IF;
  IF p_capacity IS NOT NULL AND p_capacity < 1 THEN
    RAISE EXCEPTION 'Capacity must be at least 1';
  END IF;

  INSERT INTO class_occurrences (studio_id, offering_id, location_id, teacher_id, starts_at, ends_at, capacity)
  VALUES (
    v_studio, p_offering_id, p_location_id, p_teacher_id, v_start,
    v_start + make_interval(mins => v_offering.duration_minutes),
    COALESCE(p_capacity, v_offering.capacity)
  )
  RETURNING * INTO v_row;
  RETURN v_row;
END;
$$;

CREATE OR REPLACE FUNCTION manage_update_session(
  p_occurrence_id UUID,
  p_date DATE,
  p_start_time TIME,
  p_teacher_id UUID,
  p_location_id UUID,
  p_capacity INTEGER
)
RETURNS class_occurrences
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_occ class_occurrences%ROWTYPE;
  v_tz TEXT;
  v_start TIMESTAMPTZ;
BEGIN
  SELECT * INTO v_occ FROM class_occurrences WHERE id = p_occurrence_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Session not found';
  END IF;
  PERFORM manage_check_schedule_refs(v_occ.offering_id, p_location_id, p_teacher_id);
  IF v_occ.is_cancelled THEN
    RAISE EXCEPTION 'This session is cancelled';
  END IF;
  IF p_capacity IS NULL OR p_capacity < 1 THEN
    RAISE EXCEPTION 'Capacity must be at least 1';
  END IF;
  IF p_capacity < COALESCE(v_occ.booked_count, 0) THEN
    RAISE EXCEPTION 'Capacity cannot be lower than the % people already booked', v_occ.booked_count;
  END IF;
  SELECT timezone INTO v_tz FROM studios WHERE id = v_occ.studio_id;
  v_start := (p_date + p_start_time) AT TIME ZONE v_tz;

  UPDATE class_occurrences SET
    starts_at = v_start,
    ends_at = v_start + (v_occ.ends_at - v_occ.starts_at),
    teacher_id = p_teacher_id,
    location_id = p_location_id,
    capacity = p_capacity
  WHERE id = p_occurrence_id
  RETURNING * INTO v_occ;
  RETURN v_occ;
END;
$$;

-- Cancels one session and its bookings. Passes and memberships get the class
-- back; bookings paid by card are counted so the owner can refund them in Stripe.
CREATE OR REPLACE FUNCTION cancel_occurrence_internal(p_occurrence_id UUID, p_reason TEXT)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_booking bookings%ROWTYPE;
  v_cancelled INTEGER := 0;
  v_paid INTEGER := 0;
BEGIN
  UPDATE class_occurrences
    SET is_cancelled = TRUE, cancellation_reason = NULLIF(BTRIM(p_reason), ''), cancelled_at = NOW()
    WHERE id = p_occurrence_id;

  -- Waitlist first, so cancelling a confirmed spot does not promote anyone.
  UPDATE bookings SET status = 'cancelled', cancelled_at = NOW(), cancel_reason = 'Session cancelled', waitlist_position = NULL
    WHERE class_occurrence_id = p_occurrence_id AND status = 'waitlisted';

  FOR v_booking IN
    SELECT * FROM bookings WHERE class_occurrence_id = p_occurrence_id AND status = 'confirmed'
  LOOP
    IF v_booking.class_pack_id IS NOT NULL THEN
      UPDATE class_packs
        SET classes_remaining = LEAST(classes_remaining + 1, classes_total),
            status = CASE WHEN status = 'exhausted' THEN 'active'::class_pack_status ELSE status END
        WHERE id = v_booking.class_pack_id;
    ELSIF v_booking.membership_id IS NOT NULL THEN
      UPDATE memberships SET classes_used_this_cycle = GREATEST(0, classes_used_this_cycle - 1)
        WHERE id = v_booking.membership_id;
    ELSIF v_booking.transaction_id IS NOT NULL THEN
      v_paid := v_paid + 1;
    END IF;
    UPDATE bookings SET status = 'cancelled', cancelled_at = NOW(), cancel_reason = 'Session cancelled'
      WHERE id = v_booking.id;
    v_cancelled := v_cancelled + 1;
  END LOOP;

  RETURN jsonb_build_object('bookings_cancelled', v_cancelled, 'paid_bookings', v_paid);
END;
$$;

CREATE OR REPLACE FUNCTION manage_cancel_session(p_occurrence_id UUID, p_reason TEXT DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_occ class_occurrences%ROWTYPE;
BEGIN
  SELECT * INTO v_occ FROM class_occurrences WHERE id = p_occurrence_id;
  IF NOT FOUND OR NOT is_studio_manager(v_occ.studio_id) THEN
    RAISE EXCEPTION 'Not allowed to manage this session' USING ERRCODE = '42501';
  END IF;
  IF v_occ.is_cancelled THEN
    RAISE EXCEPTION 'This session is already cancelled';
  END IF;
  RETURN cancel_occurrence_internal(p_occurrence_id, p_reason);
END;
$$;

-- Ends a weekly schedule: future sessions nobody booked are removed, the ones
-- with bookings are cancelled (and the bookings released).
CREATE OR REPLACE FUNCTION manage_end_schedule(p_rule_id UUID)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_rule schedule_rules%ROWTYPE;
  v_tz TEXT;
  v_occ RECORD;
  v_removed INTEGER := 0;
  v_cancelled INTEGER := 0;
BEGIN
  SELECT * INTO v_rule FROM schedule_rules WHERE id = p_rule_id;
  IF NOT FOUND OR NOT is_studio_manager(v_rule.studio_id) THEN
    RAISE EXCEPTION 'Not allowed to manage this schedule' USING ERRCODE = '42501';
  END IF;
  SELECT timezone INTO v_tz FROM studios WHERE id = v_rule.studio_id;

  UPDATE schedule_rules SET is_active = FALSE, effective_until = (NOW() AT TIME ZONE v_tz)::DATE
    WHERE id = p_rule_id;

  FOR v_occ IN
    SELECT co.id, EXISTS (SELECT 1 FROM bookings b WHERE b.class_occurrence_id = co.id) AS has_bookings
    FROM class_occurrences co
    WHERE co.schedule_rule_id = p_rule_id AND co.starts_at > NOW() AND NOT COALESCE(co.is_cancelled, FALSE)
  LOOP
    IF v_occ.has_bookings THEN
      PERFORM cancel_occurrence_internal(v_occ.id, 'Weekly schedule ended');
      v_cancelled := v_cancelled + 1;
    ELSE
      DELETE FROM class_occurrences WHERE id = v_occ.id;
      v_removed := v_removed + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('sessions_removed', v_removed, 'sessions_cancelled', v_cancelled);
END;
$$;

-- Keeps every active weekly schedule filled p_weeks_ahead weeks into the future.
-- Called when a manager opens the schedule or dashboard.
CREATE OR REPLACE FUNCTION manage_top_up_schedules(p_studio_id UUID, p_weeks_ahead INTEGER DEFAULT 12)
RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_tz TEXT;
  v_rule RECORD;
  v_total INTEGER := 0;
BEGIN
  IF NOT is_studio_manager(p_studio_id) THEN
    RAISE EXCEPTION 'Not allowed to manage this studio' USING ERRCODE = '42501';
  END IF;
  SELECT timezone INTO v_tz FROM studios WHERE id = p_studio_id;
  FOR v_rule IN SELECT id FROM schedule_rules WHERE studio_id = p_studio_id AND COALESCE(is_active, TRUE) LOOP
    v_total := v_total + generate_rule_occurrences(
      v_rule.id,
      (NOW() AT TIME ZONE v_tz)::DATE + LEAST(GREATEST(COALESCE(p_weeks_ahead, 12), 1), 26) * 7
    );
  END LOOP;
  RETURN v_total;
END;
$$;

-- ============================================================================
-- 3b. Staff bookings and attendance
-- ============================================================================

-- Books a member into a session on their behalf. p_source:
--   'auto' — use the member's pass (class pack first, then membership), else complimentary
--   'comp' — complimentary, nothing is used up
CREATE OR REPLACE FUNCTION staff_book_member(p_occurrence_id UUID, p_profile_id UUID, p_source TEXT DEFAULT 'auto')
RETURNS bookings
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_occ class_occurrences%ROWTYPE;
  v_pack UUID;
  v_membership UUID;
  v_booking bookings%ROWTYPE;
BEGIN
  SELECT * INTO v_occ FROM class_occurrences WHERE id = p_occurrence_id FOR UPDATE;
  IF NOT FOUND OR NOT is_studio_staff(v_occ.studio_id, ARRAY['owner', 'admin', 'front_desk']::user_role[]) THEN
    RAISE EXCEPTION 'Not allowed to book for this session' USING ERRCODE = '42501';
  END IF;
  IF v_occ.is_cancelled THEN
    RAISE EXCEPTION 'This session is cancelled';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = p_profile_id) THEN
    RAISE EXCEPTION 'Member not found';
  END IF;

  -- One active booking per member and session (the rule 00030 enforces with a
  -- partial unique index); earlier cancelled bookings stay as history.
  IF EXISTS (
    SELECT 1 FROM bookings
    WHERE class_occurrence_id = p_occurrence_id AND profile_id = p_profile_id
      AND status NOT IN ('cancelled', 'late_cancel')
  ) THEN
    RAISE EXCEPTION 'This member is already booked for this session';
  END IF;
  IF COALESCE(v_occ.booked_count, 0) >= v_occ.capacity THEN
    RAISE EXCEPTION 'This session is full';
  END IF;

  IF COALESCE(p_source, 'auto') = 'auto' THEN
    SELECT cp.id INTO v_pack
    FROM class_packs cp
    JOIN class_pack_types cpt ON cpt.id = cp.class_pack_type_id
    WHERE cp.profile_id = p_profile_id AND cp.studio_id = v_occ.studio_id
      AND cp.status = 'active' AND cp.classes_remaining > 0 AND cp.expires_at > NOW()
      AND (array_length(cpt.offering_ids, 1) IS NULL OR v_occ.offering_id = ANY(cpt.offering_ids))
    ORDER BY cp.expires_at
    LIMIT 1;

    IF v_pack IS NULL THEN
      SELECT m.id INTO v_membership
      FROM memberships m
      JOIN membership_types mt ON mt.id = m.membership_type_id
      WHERE m.profile_id = p_profile_id AND m.studio_id = v_occ.studio_id
        AND m.status = 'active' AND NOW() BETWEEN m.current_period_start AND m.current_period_end
        AND (mt.classes_per_cycle IS NULL OR m.classes_used_this_cycle < mt.classes_per_cycle)
        AND (array_length(mt.offering_ids, 1) IS NULL OR v_occ.offering_id = ANY(mt.offering_ids))
      ORDER BY m.current_period_end
      LIMIT 1;
    END IF;
  ELSIF p_source <> 'comp' THEN
    RAISE EXCEPTION 'Unknown booking source: %', p_source;
  END IF;

  INSERT INTO studio_members (studio_id, profile_id) VALUES (v_occ.studio_id, p_profile_id)
  ON CONFLICT (studio_id, profile_id) DO NOTHING;

  -- decrement_pack_on_booking / increment_membership_on_booking use up the pass.
  INSERT INTO bookings (studio_id, class_occurrence_id, profile_id, status, class_pack_id, membership_id)
  VALUES (v_occ.studio_id, p_occurrence_id, p_profile_id, 'confirmed', v_pack, v_membership)
  RETURNING * INTO v_booking;

  RETURN v_booking;
END;
$$;

CREATE OR REPLACE FUNCTION staff_set_attendance(p_booking_id UUID, p_status TEXT)
RETURNS bookings
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_booking bookings%ROWTYPE;
BEGIN
  SELECT * INTO v_booking FROM bookings WHERE id = p_booking_id;
  IF NOT FOUND OR NOT is_studio_staff(v_booking.studio_id, ARRAY['owner', 'admin', 'front_desk', 'teacher']::user_role[]) THEN
    RAISE EXCEPTION 'Not allowed to mark attendance for this booking' USING ERRCODE = '42501';
  END IF;
  IF p_status NOT IN ('confirmed', 'checked_in', 'no_show') THEN
    RAISE EXCEPTION 'Attendance must be confirmed, checked_in or no_show';
  END IF;
  IF v_booking.status NOT IN ('confirmed', 'checked_in', 'no_show') THEN
    RAISE EXCEPTION 'Only a confirmed booking can be marked';
  END IF;

  UPDATE bookings SET
    status = p_status::booking_status,
    checked_in_at = CASE WHEN p_status = 'checked_in' THEN NOW() ELSE NULL END,
    checked_in_by = CASE WHEN p_status = 'checked_in' THEN auth.uid() ELSE NULL END
  WHERE id = p_booking_id
  RETURNING * INTO v_booking;
  RETURN v_booking;
END;
$$;

-- ============================================================================
-- 3c. Read models for the owner screens
-- ============================================================================

CREATE OR REPLACE FUNCTION manage_my_studio()
RETURNS JSONB
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'id', s.id, 'name', s.name, 'slug', s.slug, 'timezone', s.timezone, 'currency', s.currency,
    'discoverable', COALESCE(s.discoverable, FALSE),
    'stripe_account_id', s.stripe_account_id,
    'stripe_onboarding_complete', COALESCE(s.stripe_onboarding_complete, FALSE),
    'role', ss.role
  )
  FROM studio_staff ss
  JOIN studios s ON s.id = ss.studio_id
  WHERE ss.profile_id = auth.uid() AND COALESCE(ss.is_active, TRUE)
  ORDER BY CASE ss.role WHEN 'owner' THEN 1 WHEN 'admin' THEN 2 WHEN 'front_desk' THEN 3 ELSE 4 END, s.created_at
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION manage_list_members(p_studio_id UUID, p_search TEXT DEFAULT NULL, p_limit INTEGER DEFAULT 200)
RETURNS TABLE (
  profile_id UUID,
  first_name TEXT,
  last_name TEXT,
  email TEXT,
  phone TEXT,
  joined_at TIMESTAMPTZ,
  total_classes_attended INTEGER,
  last_class_at TIMESTAMPTZ,
  active_passes INTEGER,
  upcoming_bookings INTEGER
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_search TEXT := NULLIF(BTRIM(COALESCE(p_search, '')), '');
BEGIN
  IF NOT is_studio_staff(p_studio_id, ARRAY['owner', 'admin', 'front_desk']::user_role[]) THEN
    RAISE EXCEPTION 'Not allowed to view members' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT
    p.id, p.first_name, p.last_name, p.email, p.phone, sm.created_at,
    COALESCE(sm.total_classes_attended, 0), sm.last_class_at,
    (
      (SELECT COUNT(*) FROM class_packs cp WHERE cp.studio_id = p_studio_id AND cp.profile_id = p.id
         AND cp.status = 'active' AND cp.classes_remaining > 0 AND cp.expires_at > NOW())
      + (SELECT COUNT(*) FROM memberships m WHERE m.studio_id = p_studio_id AND m.profile_id = p.id AND m.status = 'active')
    )::INTEGER,
    (SELECT COUNT(*) FROM bookings b JOIN class_occurrences co ON co.id = b.class_occurrence_id
       WHERE b.studio_id = p_studio_id AND b.profile_id = p.id AND b.status = 'confirmed' AND co.starts_at > NOW())::INTEGER
  FROM studio_members sm
  JOIN profiles p ON p.id = sm.profile_id
  WHERE sm.studio_id = p_studio_id
    AND (
      v_search IS NULL
      OR p.email ILIKE '%' || v_search || '%'
      OR COALESCE(p.first_name, '') || ' ' || COALESCE(p.last_name, '') ILIKE '%' || v_search || '%'
      OR COALESCE(p.phone, '') ILIKE '%' || v_search || '%'
    )
  ORDER BY sm.created_at DESC
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 200), 1), 500);
END;
$$;

CREATE OR REPLACE FUNCTION manage_dashboard(p_studio_id UUID)
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_tz TEXT;
  v_day_start TIMESTAMPTZ;
  v_day_end TIMESTAMPTZ;
  v_result JSONB;
BEGIN
  IF NOT is_studio_staff(p_studio_id, ARRAY['owner', 'admin', 'front_desk']::user_role[]) THEN
    RAISE EXCEPTION 'Not allowed to view this studio' USING ERRCODE = '42501';
  END IF;
  SELECT timezone INTO v_tz FROM studios WHERE id = p_studio_id;
  v_day_start := ((NOW() AT TIME ZONE v_tz)::DATE)::TIMESTAMP AT TIME ZONE v_tz;
  v_day_end := (((NOW() AT TIME ZONE v_tz)::DATE + 1))::TIMESTAMP AT TIME ZONE v_tz;

  WITH sessions AS (
    SELECT co.id, co.starts_at, co.ends_at, co.capacity,
           COALESCE(co.booked_count, 0) AS booked_count,
           COALESCE(co.checked_in_count, 0) AS checked_in_count,
           o.name AS class_name, l.name AS location_name,
           NULLIF(BTRIM(COALESCE(p.display_name, COALESCE(p.first_name, '') || ' ' || COALESCE(p.last_name, ''))), '') AS coach_name
    FROM class_occurrences co
    JOIN offerings o ON o.id = co.offering_id
    LEFT JOIN locations l ON l.id = co.location_id
    LEFT JOIN profiles p ON p.id = co.teacher_id
    WHERE co.studio_id = p_studio_id AND NOT COALESCE(co.is_cancelled, FALSE)
  )
  SELECT jsonb_build_object(
    'today_sessions', COALESCE((
      SELECT jsonb_agg(to_jsonb(s) ORDER BY s.starts_at) FROM sessions s
      WHERE s.starts_at >= v_day_start AND s.starts_at < v_day_end), '[]'::jsonb),
    'today_bookings', (
      SELECT COUNT(*) FROM bookings b JOIN class_occurrences co ON co.id = b.class_occurrence_id
      WHERE b.studio_id = p_studio_id AND b.status IN ('confirmed', 'checked_in', 'no_show')
        AND NOT COALESCE(co.is_cancelled, FALSE)
        AND co.starts_at >= v_day_start AND co.starts_at < v_day_end),
    'upcoming_sessions', COALESCE((
      SELECT jsonb_agg(to_jsonb(u) ORDER BY u.starts_at)
      FROM (SELECT * FROM sessions s WHERE s.starts_at >= v_day_end ORDER BY s.starts_at LIMIT 8) u), '[]'::jsonb),
    'upcoming_count', (SELECT COUNT(*) FROM sessions s WHERE s.starts_at >= NOW() AND s.starts_at < NOW() + INTERVAL '7 days'),
    'recent_signups', COALESCE((
      SELECT jsonb_agg(to_jsonb(r) ORDER BY r.joined_at DESC)
      FROM (
        SELECT sm.profile_id, sm.created_at AS joined_at, pr.email,
               NULLIF(BTRIM(COALESCE(pr.first_name, '') || ' ' || COALESCE(pr.last_name, '')), '') AS name
        FROM studio_members sm JOIN profiles pr ON pr.id = sm.profile_id
        WHERE sm.studio_id = p_studio_id
        ORDER BY sm.created_at DESC LIMIT 8
      ) r), '[]'::jsonb),
    'member_count', (SELECT COUNT(*) FROM studio_members sm WHERE sm.studio_id = p_studio_id),
    'class_type_count', (SELECT COUNT(*) FROM offerings o WHERE o.studio_id = p_studio_id AND COALESCE(o.is_active, TRUE))
  ) INTO v_result;
  RETURN v_result;
END;
$$;

-- ============================================================================
-- Privileges
-- ============================================================================

-- Internal helpers: never callable through the API.
REVOKE ALL ON FUNCTION generate_rule_occurrences(UUID, DATE) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION cancel_occurrence_internal(UUID, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION is_allowlisted_owner(UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION studio_setup_access_for(UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION create_studio_for_owner(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION ensure_studio_member() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION enforce_single_studio() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION enforce_owner_allowlist() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION enrol_profile_in_single_studio() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION studio_setup_access_for(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION create_studio_for_owner(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION generate_rule_occurrences(UUID, DATE) TO service_role;

-- Signed-in callers only; each function checks the caller's studio role itself.
DO $$
DECLARE
  fn TEXT;
BEGIN
  FOREACH fn IN ARRAY ARRAY[
    'studio_setup_access()',
    'manage_my_studio()',
    'manage_check_schedule_refs(UUID, UUID, UUID)',
    'manage_create_weekly_schedule(UUID, UUID, UUID, day_of_week, TIME, DATE, DATE, INTEGER, INTEGER)',
    'manage_create_session(UUID, UUID, UUID, DATE, TIME, INTEGER)',
    'manage_update_session(UUID, DATE, TIME, UUID, UUID, INTEGER)',
    'manage_cancel_session(UUID, TEXT)',
    'manage_end_schedule(UUID)',
    'manage_top_up_schedules(UUID, INTEGER)',
    'staff_book_member(UUID, UUID, TEXT)',
    'staff_set_attendance(UUID, TEXT)',
    'manage_list_members(UUID, TEXT, INTEGER)',
    'manage_dashboard(UUID)'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon', fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated, service_role', fn);
  END LOOP;
END $$;

-- Used inside RLS policies, which anonymous requests also evaluate.
GRANT EXECUTE ON FUNCTION auth_staff_studio_ids(user_role[]) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION is_studio_staff(UUID, user_role[]) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION is_studio_manager(UUID) TO anon, authenticated, service_role;
