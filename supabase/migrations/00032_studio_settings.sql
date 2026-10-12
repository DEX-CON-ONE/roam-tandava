-- Owner settings: one checked way for a studio's owner to correct the facts
-- the setup wizard collects (name, booking-page address, contact email,
-- timezone, cancellation window, listing, brand colours).
--
-- The existing "Owners and admins can update studios" policy allows a direct
-- UPDATE, but with no validation: a blank name, a slug that is not URL-safe or
-- a timezone Postgres does not know would all be accepted, and each of those
-- breaks the public booking page or the schedule. This function validates and
-- touches only these columns. Nothing here inserts data.

CREATE OR REPLACE FUNCTION is_valid_studio_slug(p_slug TEXT)
RETURNS BOOLEAN
LANGUAGE sql IMMUTABLE
AS $$
  SELECT p_slug IS NOT NULL
    AND LENGTH(p_slug) BETWEEN 2 AND 60
    AND p_slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$';
$$;

CREATE OR REPLACE FUNCTION manage_update_studio(
  p_studio_id UUID,
  p_name TEXT,
  p_slug TEXT,
  p_email TEXT,
  p_timezone TEXT,
  p_cancellation_minutes INTEGER,
  p_discoverable BOOLEAN,
  p_primary_color TEXT,
  p_secondary_color TEXT
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_name TEXT := BTRIM(COALESCE(p_name, ''));
  v_slug TEXT := LOWER(BTRIM(COALESCE(p_slug, '')));
  v_email TEXT := LOWER(BTRIM(COALESCE(p_email, '')));
BEGIN
  IF NOT is_studio_staff(p_studio_id, ARRAY['owner']::user_role[]) THEN
    RAISE EXCEPTION 'Only the studio owner can change these settings' USING ERRCODE = '42501';
  END IF;
  IF v_name = '' THEN
    RAISE EXCEPTION 'The studio needs a name';
  END IF;
  IF NOT is_valid_studio_slug(v_slug) THEN
    RAISE EXCEPTION 'The booking page address can use lowercase letters, numbers and single hyphens (2 to 60 characters)';
  END IF;
  IF EXISTS (SELECT 1 FROM studios WHERE slug = v_slug AND id <> p_studio_id) THEN
    RAISE EXCEPTION 'That booking page address is already taken';
  END IF;
  IF v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' THEN
    RAISE EXCEPTION 'Enter a contact email address';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_timezone_names WHERE name = p_timezone) THEN
    RAISE EXCEPTION 'Unknown timezone: %', COALESCE(p_timezone, '(none)');
  END IF;
  IF p_cancellation_minutes IS NULL OR p_cancellation_minutes < 0 OR p_cancellation_minutes > 20160 THEN
    RAISE EXCEPTION 'The cancellation window must be between 0 minutes and 14 days';
  END IF;
  IF COALESCE(p_primary_color, '') !~ '^#[0-9a-fA-F]{6}$' OR COALESCE(p_secondary_color, '') !~ '^#[0-9a-fA-F]{6}$' THEN
    RAISE EXCEPTION 'Colours must be six-digit hex values such as #b66d3b';
  END IF;

  UPDATE studios SET
    name = v_name,
    slug = v_slug,
    email = v_email,
    timezone = p_timezone,
    default_cancellation_minutes = p_cancellation_minutes,
    discoverable = COALESCE(p_discoverable, FALSE),
    brand_primary_color = LOWER(p_primary_color),
    brand_secondary_color = LOWER(p_secondary_color)
  WHERE id = p_studio_id;

  RETURN manage_my_studio();
END;
$$;

-- The owner screens' studio record now carries the settings fields too.
CREATE OR REPLACE FUNCTION manage_my_studio()
RETURNS JSONB
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'id', s.id, 'name', s.name, 'slug', s.slug, 'timezone', s.timezone, 'currency', s.currency,
    'discoverable', COALESCE(s.discoverable, FALSE),
    'stripe_account_id', s.stripe_account_id,
    'stripe_onboarding_complete', COALESCE(s.stripe_onboarding_complete, FALSE),
    'role', ss.role,
    'email', s.email,
    'description', s.description,
    'cancellation_minutes', COALESCE(s.default_cancellation_minutes, 120),
    'primary_color', s.brand_primary_color,
    'secondary_color', s.brand_secondary_color,
    'font', s.brand_font
  )
  FROM studio_staff ss
  JOIN studios s ON s.id = ss.studio_id
  WHERE ss.profile_id = auth.uid() AND COALESCE(ss.is_active, TRUE)
  ORDER BY CASE ss.role WHEN 'owner' THEN 1 WHEN 'admin' THEN 2 WHEN 'front_desk' THEN 3 ELSE 4 END, s.created_at
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION manage_update_studio(UUID, TEXT, TEXT, TEXT, TEXT, INTEGER, BOOLEAN, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION manage_update_studio(UUID, TEXT, TEXT, TEXT, TEXT, INTEGER, BOOLEAN, TEXT, TEXT) TO authenticated, service_role;
REVOKE ALL ON FUNCTION manage_my_studio() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION manage_my_studio() TO authenticated, service_role;
