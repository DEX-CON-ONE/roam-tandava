-- Local-only Roam Athletics fixture for the Tandava fork.
-- This migration contains no credentials and is safe to apply repeatedly.
-- Commercial values not published by Roam are intentionally left NULL.

DO $$
DECLARE
  v_studio UUID;
  v_location UUID;
  v_offering UUID;
  v_start TIMESTAMPTZ;
  v_day DATE;
  v_time TIME;
  v_name TEXT;
  v_slug TEXT;
BEGIN
  INSERT INTO studios (
    name, slug, description, timezone, currency, discoverable,
    brand_primary_color, brand_secondary_color, brand_font,
    default_cancellation_minutes, waitlist_enabled
  ) VALUES (
    'ROAM Athletic Club', 'roam-athletic-club',
    'Boutique strength and conditioning in a converted barn in Farnham.',
    'Europe/London', 'GBP', TRUE, '#1c1c1c', '#1c1c1c', 'DM Sans',
    1440, TRUE
  )
  ON CONFLICT (slug) DO UPDATE SET
    name = EXCLUDED.name,
    description = EXCLUDED.description,
    timezone = EXCLUDED.timezone,
    currency = EXCLUDED.currency,
    discoverable = EXCLUDED.discoverable,
    brand_primary_color = EXCLUDED.brand_primary_color,
    brand_secondary_color = EXCLUDED.brand_secondary_color,
    brand_font = EXCLUDED.brand_font,
    default_cancellation_minutes = EXCLUDED.default_cancellation_minutes,
    waitlist_enabled = EXCLUDED.waitlist_enabled
  RETURNING id INTO v_studio;

  IF v_studio IS NULL THEN
    SELECT id INTO v_studio FROM studios WHERE slug = 'roam-athletic-club';
  END IF;

  INSERT INTO locations (
    studio_id, name, address_line1, city, state, zip, country, is_primary
  ) VALUES (
    v_studio, 'Farnham Park', 'Farnham Park', 'Farnham', 'Surrey', 'GU35 9LW', 'UK', TRUE
  )
  ON CONFLICT DO NOTHING;

  SELECT id INTO v_location
  FROM locations
  WHERE studio_id = v_studio AND name = 'Farnham Park';

  FOREACH v_name IN ARRAY ARRAY[
    'UNDEFEATED', 'HYBRID', 'X4', 'Farnham Park Outdoor Training'
  ] LOOP
    v_slug := lower(regexp_replace(v_name, '[^a-zA-Z0-9]+', '-', 'g'));
    INSERT INTO offerings (
      studio_id, name, slug, description,
      drop_in_price_cents, discoverable, is_active
    ) VALUES (
      v_studio, v_name, v_slug,
      CASE WHEN v_name = 'Farnham Park Outdoor Training'
        THEN 'Outdoor training at Farnham Park.'
        ELSE NULL END,
      NULL, TRUE, TRUE
    )
    ON CONFLICT (studio_id, slug) DO UPDATE SET
      name = EXCLUDED.name,
      description = EXCLUDED.description,
      drop_in_price_cents = NULL,
      discoverable = TRUE,
      is_active = TRUE;
  END LOOP;

  -- Personal Training is deliberately absent: Roam does not advertise it as bookable.
  SELECT id INTO v_offering FROM offerings
  WHERE studio_id = v_studio AND slug = 'undefeated';

  -- The published timetable gives Wednesday 09:30 and Saturday 08:30 for UNDEFEATED.
  -- The schema defaults supply local harness duration/capacity; Roam's commercial
  -- values remain unknown until an authoritative schedule is provided.
  -- Seed the next eight weeks so the local storefront remains useful after reset.
  FOR v_day, v_time IN
    SELECT day::DATE, time::TIME
    FROM generate_series(CURRENT_DATE, CURRENT_DATE + 56, INTERVAL '1 day') AS days(day)
    CROSS JOIN (VALUES ('09:30'::TIME), ('08:30'::TIME)) AS times(time)
    WHERE EXTRACT(ISODOW FROM day) = CASE WHEN time = '09:30'::TIME THEN 3 ELSE 6 END
  LOOP
    v_start := (v_day + v_time) AT TIME ZONE 'Europe/London';
    INSERT INTO class_occurrences (
      studio_id, offering_id, location_id, starts_at, ends_at
    ) VALUES (
      v_studio, v_offering, v_location, v_start, v_start + INTERVAL '60 minutes'
    )
    ON CONFLICT DO NOTHING;
  END LOOP;
END $$;
