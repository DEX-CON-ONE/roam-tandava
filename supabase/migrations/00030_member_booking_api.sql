-- Member booking API: the read side of the customer journey, plus two fixes.
--
-- The member screens (schedule, class detail, my bookings, my passes) need a
-- few narrow, joined reads. As with get_public_schedule (00016) and
-- get_studio_storefront (00018), these are SECURITY DEFINER functions that
-- return only safe columns, instead of widening table-level SELECT policies:
--
--   get_studio_schedule(slug, from, days)  public; adds the caller's own booking
--   get_booking_options(occurrence)        signed-in; which of MY passes cover it
--   get_my_bookings(slug)                  signed-in; my bookings, newest first
--   get_my_passes(slug)                    signed-in; my memberships and packs
--
-- get_booking_options applies the same rules as book_class() (00012), so the
-- screen only offers a pass that the booking call will accept.
--
-- FIX: bookings had UNIQUE(class_occurrence_id, profile_id) over ALL rows, so a
-- member who cancelled could never book that class again (book_class raised a
-- unique violation), and a drop-in they then paid for was silently not booked
-- by the Stripe webhook. One ACTIVE booking per member per class is the rule
-- both code paths already check for; enforce exactly that.

ALTER TABLE bookings DROP CONSTRAINT IF EXISTS bookings_class_occurrence_id_profile_id_key;
CREATE UNIQUE INDEX IF NOT EXISTS idx_bookings_one_active_per_member
  ON bookings (class_occurrence_id, profile_id)
  WHERE status NOT IN ('cancelled', 'late_cancel');

-- FIX: every pass booking made through book_class() was charged twice.
-- book_class() (00012) consumed the class pack / membership itself, and the
-- AFTER INSERT triggers from 00001 (decrement_pack_on_booking,
-- increment_membership_on_booking) consumed it again when the booking row was
-- inserted: a 5-class pass showed 3 left after one booking, and cancel_booking()
-- (00013) only gives one back. The triggers stay (direct inserts by staff and
-- the Stage B harness rely on them); book_class() no longer consumes a second
-- time. Everything else in the function is unchanged.
CREATE OR REPLACE FUNCTION book_class(
  p_occurrence_id UUID,
  p_source_type TEXT,      -- 'membership' | 'class_pack'
  p_source_id UUID
)
RETURNS bookings
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_profile_id UUID := auth.uid();
  v_occ class_occurrences%ROWTYPE;
  v_mem memberships%ROWTYPE;
  v_mt membership_types%ROWTYPE;
  v_pack class_packs%ROWTYPE;
  v_pt class_pack_types%ROWTYPE;
  v_status booking_status;
  v_position INTEGER := NULL;
  v_booking bookings%ROWTYPE;
BEGIN
  IF v_profile_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT * INTO v_occ FROM class_occurrences WHERE id = p_occurrence_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Class not found';
  END IF;
  IF v_occ.is_cancelled THEN
    RAISE EXCEPTION 'Class is cancelled';
  END IF;

  -- Already booked? (mirrors the UNIQUE(class_occurrence_id, profile_id))
  IF EXISTS (
    SELECT 1 FROM bookings
    WHERE class_occurrence_id = p_occurrence_id
      AND profile_id = v_profile_id
      AND status NOT IN ('cancelled', 'late_cancel')
  ) THEN
    RAISE EXCEPTION 'Already booked for this class';
  END IF;

  -- Capacity decides confirmed vs waitlisted.
  IF v_occ.booked_count < v_occ.capacity THEN
    v_status := 'confirmed';
  ELSE
    v_status := 'waitlisted';
    SELECT COALESCE(MAX(waitlist_position), 0) + 1 INTO v_position
    FROM bookings
    WHERE class_occurrence_id = p_occurrence_id AND status = 'waitlisted';
  END IF;

  -- ---- Validate + consume the entitlement ----
  IF p_source_type = 'membership' THEN
    SELECT * INTO v_mem FROM memberships
      WHERE id = p_source_id AND profile_id = v_profile_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Membership not found'; END IF;
    SELECT * INTO v_mt FROM membership_types WHERE id = v_mem.membership_type_id;

    IF v_mem.status <> 'active' THEN RAISE EXCEPTION 'Membership is not active'; END IF;
    IF v_mem.expires_at IS NOT NULL AND NOW() > v_mem.expires_at THEN
      RAISE EXCEPTION 'Membership has expired';
    END IF;
    IF NOW() < v_mem.current_period_start OR NOW() > v_mem.current_period_end THEN
      RAISE EXCEPTION 'Membership is outside its billing period';
    END IF;
    IF array_length(v_mt.offering_ids, 1) IS NOT NULL
       AND NOT (v_occ.offering_id = ANY(v_mt.offering_ids)) THEN
      RAISE EXCEPTION 'Membership does not cover this class';
    END IF;
    IF array_length(v_mt.locations, 1) IS NOT NULL
       AND NOT (v_occ.location_id::text = ANY(v_mt.locations)) THEN
      RAISE EXCEPTION 'Membership does not cover this location';
    END IF;
    IF v_mt.classes_per_cycle IS NOT NULL
       AND v_mem.classes_used_this_cycle >= v_mt.classes_per_cycle THEN
      RAISE EXCEPTION 'No classes remaining in this cycle';
    END IF;

    -- The entitlement is consumed by the increment_membership_on_booking trigger
    -- when the confirmed booking row is inserted below (not for a waitlisted one).

    INSERT INTO bookings (studio_id, class_occurrence_id, profile_id, status, waitlist_position, membership_id)
      VALUES (v_occ.studio_id, p_occurrence_id, v_profile_id, v_status, v_position, v_mem.id)
      RETURNING * INTO v_booking;

  ELSIF p_source_type = 'class_pack' THEN
    SELECT * INTO v_pack FROM class_packs
      WHERE id = p_source_id AND profile_id = v_profile_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Class pack not found'; END IF;
    SELECT * INTO v_pt FROM class_pack_types WHERE id = v_pack.class_pack_type_id;

    IF v_pack.status <> 'active' THEN RAISE EXCEPTION 'Class pack is not active'; END IF;
    IF NOW() > v_pack.expires_at THEN RAISE EXCEPTION 'Class pack has expired'; END IF;
    IF v_pack.classes_remaining <= 0 THEN RAISE EXCEPTION 'No classes remaining on this pack'; END IF;
    IF array_length(v_pt.offering_ids, 1) IS NOT NULL
       AND NOT (v_occ.offering_id = ANY(v_pt.offering_ids)) THEN
      RAISE EXCEPTION 'Class pack does not cover this class';
    END IF;
    IF array_length(v_pt.locations, 1) IS NOT NULL
       AND NOT (v_occ.location_id::text = ANY(v_pt.locations)) THEN
      RAISE EXCEPTION 'Class pack does not cover this location';
    END IF;

    -- The entitlement is consumed by the decrement_pack_on_booking trigger when
    -- the confirmed booking row is inserted below (not for a waitlisted one).

    INSERT INTO bookings (studio_id, class_occurrence_id, profile_id, status, waitlist_position, class_pack_id)
      VALUES (v_occ.studio_id, p_occurrence_id, v_profile_id, v_status, v_position, v_pack.id)
      RETURNING * INTO v_booking;

  ELSE
    RAISE EXCEPTION 'Unsupported payment source: %', p_source_type;
  END IF;

  RETURN v_booking;
END;
$$;

-- ---------------------------------------------------------------------------
-- Public schedule for a discoverable studio, for a date window.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION get_studio_schedule(
  p_slug TEXT,
  p_from TIMESTAMPTZ DEFAULT NOW(),
  p_days INT DEFAULT 14
)
RETURNS TABLE (
  occurrence_id UUID,
  starts_at TIMESTAMPTZ,
  ends_at TIMESTAMPTZ,
  room TEXT,
  offering_id UUID,
  offering_name TEXT,
  offering_description TEXT,
  level TEXT,
  duration_minutes INTEGER,
  drop_in_price_cents INTEGER,
  location_name TEXT,
  location_address TEXT,
  teacher_name TEXT,
  capacity INTEGER,
  booked_count INTEGER,
  waitlist_count INTEGER,
  my_booking_id UUID,
  my_booking_status TEXT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    co.id, co.starts_at, co.ends_at, co.room,
    o.id, o.name, o.description, o.level, o.duration_minutes, o.drop_in_price_cents,
    l.name,
    NULLIF(concat_ws(', ', NULLIF(l.address_line1, ''), NULLIF(l.city, '')), ''),
    COALESCE(NULLIF(p.display_name, ''), NULLIF(btrim(concat_ws(' ', p.first_name, p.last_name)), '')),
    co.capacity, co.booked_count, co.waitlist_count,
    b.id, b.status::text
  FROM studios s
  JOIN class_occurrences co ON co.studio_id = s.id
  JOIN offerings o ON o.id = co.offering_id
  LEFT JOIN locations l ON l.id = co.location_id
  LEFT JOIN profiles p ON p.id = co.teacher_id
  LEFT JOIN bookings b
    ON b.class_occurrence_id = co.id
   AND b.profile_id = auth.uid()
   AND b.status NOT IN ('cancelled', 'late_cancel')
  WHERE s.slug = p_slug
    AND s.discoverable = TRUE
    AND co.is_cancelled = FALSE
    AND co.starts_at >= GREATEST(p_from, NOW())
    AND co.starts_at < GREATEST(p_from, NOW()) + make_interval(days => LEAST(GREATEST(p_days, 1), 60))
  ORDER BY co.starts_at ASC
  LIMIT 500;
$$;

COMMENT ON FUNCTION get_studio_schedule(TEXT, TIMESTAMPTZ, INT) IS
  'Public upcoming schedule for a discoverable studio over a date window (max 60 days), with the signed-in caller''s own active booking per class if any.';
GRANT EXECUTE ON FUNCTION get_studio_schedule(TEXT, TIMESTAMPTZ, INT) TO anon, authenticated;

-- ---------------------------------------------------------------------------
-- Which of the caller's passes can book this class (same rules as book_class).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION get_booking_options(p_occurrence_id UUID)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_occ class_occurrences%ROWTYPE;
  v_offering offerings%ROWTYPE;
  v_studio studios%ROWTYPE;
  v_existing bookings%ROWTYPE;
  v_sources jsonb := '[]'::jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT * INTO v_occ FROM class_occurrences WHERE id = p_occurrence_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Class not found'; END IF;
  SELECT * INTO v_offering FROM offerings WHERE id = v_occ.offering_id;
  SELECT * INTO v_studio FROM studios WHERE id = v_occ.studio_id;

  SELECT * INTO v_existing FROM bookings
    WHERE class_occurrence_id = p_occurrence_id AND profile_id = v_uid
      AND status NOT IN ('cancelled', 'late_cancel')
    LIMIT 1;

  SELECT COALESCE(jsonb_agg(src ORDER BY src->>'type' DESC, src->>'name'), '[]'::jsonb) INTO v_sources
  FROM (
    SELECT jsonb_build_object(
      'type', 'membership',
      'id', m.id,
      'name', mt.name,
      'remaining', CASE WHEN mt.classes_per_cycle IS NULL THEN NULL ELSE GREATEST(mt.classes_per_cycle - COALESCE(m.classes_used_this_cycle, 0), 0) END,
      'expires_at', m.current_period_end,
      'reason', CASE
        WHEN m.status <> 'active' THEN 'Membership is not active'
        WHEN m.expires_at IS NOT NULL AND NOW() > m.expires_at THEN 'Membership has expired'
        WHEN NOW() < m.current_period_start OR NOW() > m.current_period_end THEN 'Membership is outside its billing period'
        WHEN array_length(mt.offering_ids, 1) IS NOT NULL AND NOT (v_occ.offering_id = ANY(mt.offering_ids)) THEN 'Does not cover this class'
        WHEN array_length(mt.locations, 1) IS NOT NULL AND NOT (v_occ.location_id::text = ANY(mt.locations)) THEN 'Does not cover this location'
        WHEN mt.classes_per_cycle IS NOT NULL AND COALESCE(m.classes_used_this_cycle, 0) >= mt.classes_per_cycle THEN 'No classes remaining in this cycle'
        ELSE NULL END
    ) AS src
    FROM memberships m
    JOIN membership_types mt ON mt.id = m.membership_type_id
    WHERE m.profile_id = v_uid AND m.studio_id = v_occ.studio_id
      AND m.status IN ('active', 'past_due', 'paused')
    UNION ALL
    SELECT jsonb_build_object(
      'type', 'class_pack',
      'id', cp.id,
      'name', pt.name,
      'remaining', cp.classes_remaining,
      'expires_at', cp.expires_at,
      'reason', CASE
        WHEN cp.status <> 'active' THEN 'Class pack is not active'
        WHEN NOW() > cp.expires_at THEN 'Class pack has expired'
        WHEN cp.classes_remaining <= 0 THEN 'No classes remaining on this pack'
        WHEN array_length(pt.offering_ids, 1) IS NOT NULL AND NOT (v_occ.offering_id = ANY(pt.offering_ids)) THEN 'Does not cover this class'
        WHEN array_length(pt.locations, 1) IS NOT NULL AND NOT (v_occ.location_id::text = ANY(pt.locations)) THEN 'Does not cover this location'
        ELSE NULL END
    )
    FROM class_packs cp
    JOIN class_pack_types pt ON pt.id = cp.class_pack_type_id
    WHERE cp.profile_id = v_uid AND cp.studio_id = v_occ.studio_id
      AND cp.status = 'active' AND cp.expires_at > NOW()
  ) AS all_sources;

  RETURN jsonb_build_object(
    'occurrence_id', v_occ.id,
    'studio_id', v_occ.studio_id,
    'is_cancelled', v_occ.is_cancelled,
    'has_started', v_occ.starts_at <= NOW(),
    'is_full', v_occ.booked_count >= v_occ.capacity,
    'waitlist_enabled', COALESCE(v_studio.waitlist_enabled, FALSE),
    'drop_in_price_cents', v_offering.drop_in_price_cents,
    'currency', v_studio.currency,
    'cancellation_minutes', COALESCE(v_studio.default_cancellation_minutes, 120),
    'my_booking_id', v_existing.id,
    'my_booking_status', v_existing.status,
    'sources', v_sources
  );
END;
$$;

COMMENT ON FUNCTION get_booking_options(UUID) IS
  'For the signed-in caller: their memberships and class packs at the class''s studio, each with a reason when it cannot book this class (same rules as book_class), plus drop-in price, capacity state and any existing booking.';
REVOKE ALL ON FUNCTION get_booking_options(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION get_booking_options(UUID) TO authenticated;

-- ---------------------------------------------------------------------------
-- The caller's bookings at a studio.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION get_my_bookings(p_slug TEXT)
RETURNS TABLE (
  booking_id UUID,
  status TEXT,
  waitlist_position INTEGER,
  booked_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,
  paid_with TEXT,
  occurrence_id UUID,
  starts_at TIMESTAMPTZ,
  ends_at TIMESTAMPTZ,
  class_cancelled BOOLEAN,
  offering_name TEXT,
  location_name TEXT,
  teacher_name TEXT,
  free_cancel_until TIMESTAMPTZ
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    b.id, b.status::text, b.waitlist_position, b.booked_at, b.cancelled_at,
    CASE WHEN b.membership_id IS NOT NULL THEN 'membership'
         WHEN b.class_pack_id IS NOT NULL THEN 'class_pack'
         WHEN b.transaction_id IS NOT NULL THEN 'drop_in'
         ELSE 'other' END,
    co.id, co.starts_at, co.ends_at, co.is_cancelled,
    o.name, l.name,
    COALESCE(NULLIF(p.display_name, ''), NULLIF(btrim(concat_ws(' ', p.first_name, p.last_name)), '')),
    co.starts_at - make_interval(mins => COALESCE(s.default_cancellation_minutes, 120))
  FROM bookings b
  JOIN studios s ON s.id = b.studio_id
  JOIN class_occurrences co ON co.id = b.class_occurrence_id
  JOIN offerings o ON o.id = co.offering_id
  LEFT JOIN locations l ON l.id = co.location_id
  LEFT JOIN profiles p ON p.id = co.teacher_id
  WHERE b.profile_id = auth.uid()
    AND s.slug = p_slug
  ORDER BY co.starts_at DESC
  LIMIT 200;
$$;

COMMENT ON FUNCTION get_my_bookings(TEXT) IS
  'The signed-in caller''s own bookings at a studio (by slug), with class details and the time until which cancelling is free.';
REVOKE ALL ON FUNCTION get_my_bookings(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION get_my_bookings(TEXT) TO authenticated;

-- ---------------------------------------------------------------------------
-- The caller's memberships and class packs at a studio.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION get_my_passes(p_slug TEXT)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'memberships', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', m.id,
        'name', mt.name,
        'status', m.status,
        'billing_cycle', mt.billing_cycle,
        'classes_per_cycle', mt.classes_per_cycle,
        'classes_used_this_cycle', COALESCE(m.classes_used_this_cycle, 0),
        'current_period_end', m.current_period_end,
        'started_at', m.started_at
      ) ORDER BY m.started_at DESC)
      FROM memberships m
      JOIN membership_types mt ON mt.id = m.membership_type_id
      WHERE m.profile_id = auth.uid() AND m.studio_id = s.id
    ), '[]'::jsonb),
    'packs', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', cp.id,
        'name', pt.name,
        'status', CASE WHEN cp.status = 'active' AND cp.expires_at <= NOW() THEN 'expired' ELSE cp.status::text END,
        'classes_remaining', cp.classes_remaining,
        'classes_total', cp.classes_total,
        'purchased_at', cp.purchased_at,
        'expires_at', cp.expires_at
      ) ORDER BY cp.purchased_at DESC)
      FROM class_packs cp
      JOIN class_pack_types pt ON pt.id = cp.class_pack_type_id
      WHERE cp.profile_id = auth.uid() AND cp.studio_id = s.id
    ), '[]'::jsonb)
  )
  FROM studios s
  WHERE s.slug = p_slug AND auth.uid() IS NOT NULL;
$$;

COMMENT ON FUNCTION get_my_passes(TEXT) IS
  'The signed-in caller''s own memberships and class packs at a studio (by slug), with remaining classes.';
REVOKE ALL ON FUNCTION get_my_passes(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION get_my_passes(TEXT) TO authenticated;
