-- Team: let a studio's owner give other people access, safely.
--
--   * studio_invites: an invitation for one email address to hold one role
--     (owner, admin = manager, teacher = coach). It expires, can be revoked,
--     and is used once. There is no secret link: the invitation is claimed by
--     whoever proves they own that address, i.e. signs in with it after
--     confirming it. claim_studio_invites() does the claiming.
--   * A primary owner per studio (studios.primary_owner_id). Any owner manages
--     the team; only the primary owner can remove or demote another owner, and
--     hand the primary role to another owner.
--   * Single-studio mode is unchanged for creating studios. The owner
--     allow-list still decides who may CREATE the studio; after that the owner
--     role can also be granted through an invitation or by the primary owner.
--   * The owner's first-run checklist, computed from real rows.
--
-- Nothing here inserts business data.

-- ============================================================================
-- Primary owner
-- ============================================================================

ALTER TABLE studios ADD COLUMN IF NOT EXISTS primary_owner_id UUID REFERENCES profiles(id) ON DELETE SET NULL;
-- When an owner last confirmed the studio's details in Settings.
ALTER TABLE studios ADD COLUMN IF NOT EXISTS details_confirmed_at TIMESTAMPTZ;

UPDATE studios s SET primary_owner_id = (
  SELECT ss.profile_id FROM studio_staff ss
  WHERE ss.studio_id = s.id AND ss.role = 'owner' AND COALESCE(ss.is_active, TRUE)
  ORDER BY ss.created_at LIMIT 1
) WHERE s.primary_owner_id IS NULL;

CREATE OR REPLACE FUNCTION set_primary_owner()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NEW.role = 'owner' THEN
    UPDATE studios SET primary_owner_id = NEW.profile_id
    WHERE id = NEW.studio_id AND primary_owner_id IS NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS studio_staff_set_primary_owner ON studio_staff;
CREATE TRIGGER studio_staff_set_primary_owner
  AFTER INSERT OR UPDATE ON studio_staff
  FOR EACH ROW EXECUTE FUNCTION set_primary_owner();

-- ============================================================================
-- Who may hold the owner role in single-studio mode
-- ============================================================================
-- Before: only an allow-listed email. Now also a grant made inside one of the
-- checked functions below (a claimed owner invitation, or the primary owner
-- changing a role), which mark the transaction with app.owner_grant. That
-- setting cannot be set through the API: only functions in this schema can.

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
  IF NOT COALESCE(v_single, FALSE) THEN
    RETURN NEW;
  END IF;
  IF is_allowlisted_owner(NEW.profile_id) THEN
    RETURN NEW;
  END IF;
  IF NULLIF(current_setting('app.owner_grant', TRUE), '') = NEW.studio_id::TEXT || ':' || NEW.profile_id::TEXT THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'Single-studio mode: this account is not allowed to own the studio' USING ERRCODE = '42501';
END;
$$;

-- ============================================================================
-- Invitations
-- ============================================================================

CREATE TABLE IF NOT EXISTS studio_invites (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  studio_id UUID NOT NULL REFERENCES studios(id) ON DELETE CASCADE,
  email TEXT NOT NULL CHECK (email = LOWER(BTRIM(email)) AND email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
  role user_role NOT NULL CHECK (role IN ('owner', 'admin', 'teacher')),
  invited_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  accepted_at TIMESTAMPTZ,
  accepted_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
  revoked_at TIMESTAMPTZ,
  -- Last time the invitation email was handed to the mail provider, and the outcome.
  emailed_at TIMESTAMPTZ,
  email_error TEXT
);

-- One open invitation per address and studio.
CREATE UNIQUE INDEX IF NOT EXISTS idx_studio_invites_one_open
  ON studio_invites (studio_id, email)
  WHERE accepted_at IS NULL AND revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_studio_invites_email ON studio_invites (email) WHERE accepted_at IS NULL AND revoked_at IS NULL;

ALTER TABLE studio_invites ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON studio_invites FROM anon;
REVOKE INSERT, UPDATE, DELETE ON studio_invites FROM authenticated;

DROP POLICY IF EXISTS "Owners can view studio invites" ON studio_invites;
CREATE POLICY "Owners can view studio invites" ON studio_invites FOR SELECT
  USING (is_studio_staff(studio_id, ARRAY['owner']::user_role[]));

COMMENT ON TABLE studio_invites IS
  'Invitations to hold a staff role. Written only by manage_invite_staff / manage_revoke_invite / claim_studio_invites.';

CREATE OR REPLACE FUNCTION staff_role_rank(p_role user_role)
RETURNS INTEGER LANGUAGE sql IMMUTABLE
AS $$
  SELECT CASE p_role WHEN 'owner' THEN 1 WHEN 'admin' THEN 2 WHEN 'teacher' THEN 3 WHEN 'front_desk' THEN 4 ELSE 5 END;
$$;

CREATE OR REPLACE FUNCTION manage_invite_staff(p_studio_id UUID, p_email TEXT, p_role TEXT, p_days INTEGER DEFAULT 7)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_email TEXT := LOWER(BTRIM(COALESCE(p_email, '')));
  v_invite studio_invites%ROWTYPE;
BEGIN
  IF NOT is_studio_staff(p_studio_id, ARRAY['owner']::user_role[]) THEN
    RAISE EXCEPTION 'Only a studio owner can invite people' USING ERRCODE = '42501';
  END IF;
  IF v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' THEN
    RAISE EXCEPTION 'Enter the person''s email address';
  END IF;
  IF COALESCE(p_role, '') NOT IN ('owner', 'admin', 'teacher') THEN
    RAISE EXCEPTION 'Choose a role: owner, manager or coach';
  END IF;
  IF EXISTS (
    SELECT 1 FROM studio_staff ss JOIN profiles p ON p.id = ss.profile_id
    WHERE ss.studio_id = p_studio_id AND COALESCE(ss.is_active, TRUE) AND LOWER(p.email) = v_email
      AND staff_role_rank(ss.role) <= staff_role_rank(p_role::user_role)
  ) THEN
    RAISE EXCEPTION 'That person is already on the team with this role or a higher one';
  END IF;

  -- A new invitation replaces an open one for the same address.
  UPDATE studio_invites SET revoked_at = NOW()
    WHERE studio_id = p_studio_id AND email = v_email AND accepted_at IS NULL AND revoked_at IS NULL;

  INSERT INTO studio_invites (studio_id, email, role, invited_by, expires_at)
  VALUES (p_studio_id, v_email, p_role::user_role, auth.uid(), NOW() + make_interval(days => LEAST(GREATEST(COALESCE(p_days, 7), 1), 30)))
  RETURNING * INTO v_invite;

  RETURN jsonb_build_object('id', v_invite.id, 'email', v_invite.email, 'role', v_invite.role, 'expires_at', v_invite.expires_at);
END;
$$;

CREATE OR REPLACE FUNCTION manage_revoke_invite(p_invite_id UUID)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_studio UUID;
BEGIN
  SELECT studio_id INTO v_studio FROM studio_invites WHERE id = p_invite_id;
  IF v_studio IS NULL OR NOT is_studio_staff(v_studio, ARRAY['owner']::user_role[]) THEN
    RAISE EXCEPTION 'Only a studio owner can revoke an invitation' USING ERRCODE = '42501';
  END IF;
  UPDATE studio_invites SET revoked_at = NOW() WHERE id = p_invite_id AND accepted_at IS NULL AND revoked_at IS NULL;
END;
$$;

-- Records that the invitation email was (or could not be) sent. Service role only.
CREATE OR REPLACE FUNCTION record_invite_email(p_invite_id UUID, p_error TEXT DEFAULT NULL)
RETURNS VOID
LANGUAGE sql SECURITY DEFINER SET search_path = public
AS $$
  UPDATE studio_invites SET emailed_at = NOW(), email_error = NULLIF(BTRIM(COALESCE(p_error, '')), '') WHERE id = p_invite_id;
$$;

-- Gives the signed-in user every role they have a valid invitation for.
-- Valid = for their own, confirmed email address; not expired, revoked or used.
-- An existing higher role is never lowered. Returns how many were claimed.
CREATE OR REPLACE FUNCTION claim_studio_invites()
RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_email TEXT;
  v_invite studio_invites%ROWTYPE;
  v_current user_role;
  v_count INTEGER := 0;
BEGIN
  IF v_uid IS NULL THEN
    RETURN 0;
  END IF;
  SELECT LOWER(u.email) INTO v_email FROM auth.users u WHERE u.id = v_uid AND u.email_confirmed_at IS NOT NULL;
  IF v_email IS NULL THEN
    RETURN 0;
  END IF;

  FOR v_invite IN
    SELECT * FROM studio_invites
    WHERE email = v_email AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at > NOW()
    ORDER BY created_at
    FOR UPDATE
  LOOP
    SELECT role INTO v_current FROM studio_staff WHERE studio_id = v_invite.studio_id AND profile_id = v_uid;
    IF v_invite.role = 'owner' THEN
      PERFORM set_config('app.owner_grant', v_invite.studio_id::TEXT || ':' || v_uid::TEXT, TRUE);
    END IF;
    IF v_current IS NULL THEN
      INSERT INTO studio_staff (studio_id, profile_id, role, is_active) VALUES (v_invite.studio_id, v_uid, v_invite.role, TRUE);
    ELSE
      UPDATE studio_staff SET
        role = CASE WHEN staff_role_rank(v_invite.role) < staff_role_rank(role) THEN v_invite.role ELSE role END,
        is_active = TRUE
      WHERE studio_id = v_invite.studio_id AND profile_id = v_uid;
    END IF;
    PERFORM set_config('app.owner_grant', '', TRUE);
    UPDATE studio_invites SET accepted_at = NOW(), accepted_by = v_uid WHERE id = v_invite.id;
    v_count := v_count + 1;
  END LOOP;
  RETURN v_count;
END;
$$;

-- ============================================================================
-- Team management
-- ============================================================================

CREATE OR REPLACE FUNCTION manage_list_team(p_studio_id UUID)
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_primary UUID;
BEGIN
  IF NOT is_studio_staff(p_studio_id, ARRAY['owner']::user_role[]) THEN
    RAISE EXCEPTION 'Only a studio owner can view the team' USING ERRCODE = '42501';
  END IF;
  SELECT primary_owner_id INTO v_primary FROM studios WHERE id = p_studio_id;
  RETURN jsonb_build_object(
    'i_am_primary', v_primary = auth.uid(),
    'members', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'profile_id', ss.profile_id,
        'name', NULLIF(BTRIM(COALESCE(p.display_name, COALESCE(p.first_name, '') || ' ' || COALESCE(p.last_name, ''))), ''),
        'email', p.email,
        'role', ss.role,
        'is_primary', ss.profile_id = v_primary,
        'is_me', ss.profile_id = auth.uid(),
        'since', ss.created_at
      ) ORDER BY staff_role_rank(ss.role), ss.created_at)
      FROM studio_staff ss JOIN profiles p ON p.id = ss.profile_id
      WHERE ss.studio_id = p_studio_id AND COALESCE(ss.is_active, TRUE)
    ), '[]'::jsonb),
    'invites', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', i.id, 'email', i.email, 'role', i.role, 'created_at', i.created_at, 'expires_at', i.expires_at,
        'expired', i.expires_at <= NOW(), 'emailed_at', i.emailed_at, 'email_error', i.email_error
      ) ORDER BY i.created_at DESC)
      FROM studio_invites i
      WHERE i.studio_id = p_studio_id AND i.accepted_at IS NULL AND i.revoked_at IS NULL
    ), '[]'::jsonb)
  );
END;
$$;

-- Checks shared by the two functions below. Returns the target's current role.
CREATE OR REPLACE FUNCTION manage_team_guard(p_studio_id UUID, p_profile_id UUID)
RETURNS user_role
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_primary UUID;
  v_role user_role;
BEGIN
  IF NOT is_studio_staff(p_studio_id, ARRAY['owner']::user_role[]) THEN
    RAISE EXCEPTION 'Only a studio owner can change the team' USING ERRCODE = '42501';
  END IF;
  SELECT primary_owner_id INTO v_primary FROM studios WHERE id = p_studio_id;
  SELECT role INTO v_role FROM studio_staff WHERE studio_id = p_studio_id AND profile_id = p_profile_id AND COALESCE(is_active, TRUE);
  IF v_role IS NULL THEN
    RAISE EXCEPTION 'That person is not on the team';
  END IF;
  IF p_profile_id = v_primary THEN
    RAISE EXCEPTION 'The primary owner cannot be changed or removed. Transfer the primary role first.';
  END IF;
  IF v_role = 'owner' AND auth.uid() <> v_primary THEN
    RAISE EXCEPTION 'Only the primary owner can change or remove another owner' USING ERRCODE = '42501';
  END IF;
  RETURN v_role;
END;
$$;

CREATE OR REPLACE FUNCTION manage_set_staff_role(p_studio_id UUID, p_profile_id UUID, p_role TEXT)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_primary UUID;
BEGIN
  PERFORM manage_team_guard(p_studio_id, p_profile_id);
  IF COALESCE(p_role, '') NOT IN ('owner', 'admin', 'teacher') THEN
    RAISE EXCEPTION 'Choose a role: owner, manager or coach';
  END IF;
  SELECT primary_owner_id INTO v_primary FROM studios WHERE id = p_studio_id;
  IF p_role = 'owner' THEN
    IF auth.uid() <> v_primary THEN
      RAISE EXCEPTION 'Only the primary owner can make someone an owner. Any owner can invite one.' USING ERRCODE = '42501';
    END IF;
    PERFORM set_config('app.owner_grant', p_studio_id::TEXT || ':' || p_profile_id::TEXT, TRUE);
  END IF;
  UPDATE studio_staff SET role = p_role::user_role WHERE studio_id = p_studio_id AND profile_id = p_profile_id;
  PERFORM set_config('app.owner_grant', '', TRUE);
END;
$$;

CREATE OR REPLACE FUNCTION manage_remove_staff(p_studio_id UUID, p_profile_id UUID)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  PERFORM manage_team_guard(p_studio_id, p_profile_id);
  -- Sessions they were coaching stay on the schedule with no coach assigned.
  UPDATE class_occurrences SET teacher_id = NULL WHERE studio_id = p_studio_id AND teacher_id = p_profile_id AND starts_at > NOW();
  UPDATE schedule_rules SET teacher_id = NULL WHERE studio_id = p_studio_id AND teacher_id = p_profile_id;
  DELETE FROM studio_staff WHERE studio_id = p_studio_id AND profile_id = p_profile_id;
END;
$$;

-- Hands the primary role to another owner. The caller stays an owner.
CREATE OR REPLACE FUNCTION manage_transfer_primary_owner(p_studio_id UUID, p_profile_id UUID)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM studios WHERE id = p_studio_id AND primary_owner_id = auth.uid())
     OR NOT is_studio_staff(p_studio_id, ARRAY['owner']::user_role[]) THEN
    RAISE EXCEPTION 'Only the primary owner can transfer the primary role' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM studio_staff WHERE studio_id = p_studio_id AND profile_id = p_profile_id AND role = 'owner' AND COALESCE(is_active, TRUE)
  ) THEN
    RAISE EXCEPTION 'The primary role can only go to someone who is already an owner';
  END IF;
  UPDATE studios SET primary_owner_id = p_profile_id WHERE id = p_studio_id;
END;
$$;

-- ============================================================================
-- Settings: saving them counts as confirming the studio's details
-- ============================================================================

CREATE OR REPLACE FUNCTION manage_confirm_studio_details(p_studio_id UUID)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT is_studio_staff(p_studio_id, ARRAY['owner']::user_role[]) THEN
    RAISE EXCEPTION 'Only the studio owner can confirm these details' USING ERRCODE = '42501';
  END IF;
  UPDATE studios SET details_confirmed_at = NOW() WHERE id = p_studio_id;
END;
$$;

-- ============================================================================
-- First-run checklist, from real rows
-- ============================================================================

CREATE OR REPLACE FUNCTION manage_setup_checklist(p_studio_id UUID)
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_studio studios%ROWTYPE;
BEGIN
  IF NOT is_studio_staff(p_studio_id, ARRAY['owner', 'admin']::user_role[]) THEN
    RAISE EXCEPTION 'Not allowed to view this studio' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_studio FROM studios WHERE id = p_studio_id;
  RETURN jsonb_build_object(
    'details_confirmed', v_studio.details_confirmed_at IS NOT NULL,
    'has_class_times', EXISTS (
      SELECT 1 FROM class_occurrences co
      WHERE co.studio_id = p_studio_id AND co.starts_at > NOW() AND NOT COALESCE(co.is_cancelled, FALSE)),
    'has_prices', EXISTS (SELECT 1 FROM offerings o WHERE o.studio_id = p_studio_id AND COALESCE(o.is_active, TRUE) AND o.drop_in_price_cents > 0)
      OR EXISTS (SELECT 1 FROM class_pack_types t WHERE t.studio_id = p_studio_id AND COALESCE(t.is_active, TRUE))
      OR EXISTS (SELECT 1 FROM membership_types t WHERE t.studio_id = p_studio_id AND COALESCE(t.is_active, TRUE)),
    'stripe_connected', v_studio.stripe_account_id IS NOT NULL AND COALESCE(v_studio.stripe_onboarding_complete, FALSE),
    'public_booking', COALESCE(v_studio.discoverable, FALSE),
    'has_booking', EXISTS (SELECT 1 FROM bookings b WHERE b.studio_id = p_studio_id)
  );
END;
$$;

-- ============================================================================
-- Privileges
-- ============================================================================

REVOKE ALL ON FUNCTION set_primary_owner() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION record_invite_email(UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION record_invite_email(UUID, TEXT) TO service_role;

DO $$
DECLARE
  fn TEXT;
BEGIN
  FOREACH fn IN ARRAY ARRAY[
    'manage_invite_staff(UUID, TEXT, TEXT, INTEGER)',
    'manage_revoke_invite(UUID)',
    'claim_studio_invites()',
    'manage_list_team(UUID)',
    'manage_team_guard(UUID, UUID)',
    'manage_set_staff_role(UUID, UUID, TEXT)',
    'manage_remove_staff(UUID, UUID)',
    'manage_transfer_primary_owner(UUID, UUID)',
    'manage_confirm_studio_details(UUID)',
    'manage_setup_checklist(UUID)'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon', fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated, service_role', fn);
  END LOOP;
END $$;
