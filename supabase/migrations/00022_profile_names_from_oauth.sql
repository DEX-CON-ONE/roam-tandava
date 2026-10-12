-- Profile creation on sign-up: sensible names for OAuth users, and a pinned search_path.
--
-- 1. Google (and other OAuth providers) do not send `first_name` / `last_name`.
--    Depending on the flow they send `given_name` / `family_name` and/or
--    `full_name` / `name`, so OAuth users were created with empty names.
--    Password sign-ups send `first_name` / `last_name`; when either is present
--    the values are used exactly as before.
-- 2. The function is SECURITY DEFINER and is fired by the Auth service, whose
--    role (`supabase_auth_admin`) has `search_path = auth`. The original
--    unqualified `profiles` reference only resolves when the caller's
--    search_path happens to include `public`. Pin it.
--
-- Only the INSERT trigger function is replaced. Existing profile rows are not
-- touched, so a name a user has already set is never overwritten.

CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  meta JSONB := COALESCE(NEW.raw_user_meta_data, '{}'::jsonb);
  v_first TEXT := COALESCE(meta->>'first_name', '');
  v_last TEXT := COALESCE(meta->>'last_name', '');
  v_full TEXT;
BEGIN
  -- Password sign-up (or any client that sends explicit names): unchanged.
  IF BTRIM(v_first) = '' AND BTRIM(v_last) = '' THEN
    v_first := BTRIM(COALESCE(meta->>'given_name', ''));
    v_last := BTRIM(COALESCE(meta->>'family_name', ''));

    IF v_first = '' THEN
      -- Collapse whitespace, then split "First Rest Of Name" on the first space.
      v_full := BTRIM(regexp_replace(COALESCE(NULLIF(BTRIM(meta->>'full_name'), ''), meta->>'name', ''), '\s+', ' ', 'g'));
      IF v_full <> '' THEN
        v_first := split_part(v_full, ' ', 1);
        IF v_last = '' THEN
          v_last := BTRIM(substr(v_full, length(v_first) + 1));
        END IF;
      END IF;
    END IF;
  END IF;

  INSERT INTO public.profiles (id, email, first_name, last_name)
  VALUES (NEW.id, NEW.email, v_first, v_last);
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION handle_new_user() IS
  'Creates the profiles row for a new auth user. Uses first_name/last_name when sent (password sign-up), else given_name/family_name, else splits full_name/name (OAuth).';
