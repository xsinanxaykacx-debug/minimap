-- LAB-only Raw WebRTC signaling authorization and profile bootstrap.
-- Private room channels are accessible only to authenticated active members.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'realtime' AND tablename = 'messages'
      AND policyname = 'live_room_signaling_select_active'
  ) THEN
    CREATE POLICY live_room_signaling_select_active
      ON realtime.messages FOR SELECT TO authenticated
      USING (
        realtime.topic() LIKE 'room:%'
        AND (SELECT public.is_active_member())
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'realtime' AND tablename = 'messages'
      AND policyname = 'live_room_signaling_insert_active'
  ) THEN
    CREATE POLICY live_room_signaling_insert_active
      ON realtime.messages FOR INSERT TO authenticated
      WITH CHECK (
        realtime.topic() LIKE 'room:%'
        AND (SELECT public.is_active_member())
      );
  END IF;
END
$$;

-- Realtime Postgres Changes listens to the base table (not the public view).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'live_sessions'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.live_sessions;
  END IF;
END
$$;

-- New signups receive a pending profile; an administrator must activate them.
CREATE OR REPLACE FUNCTION public.handle_new_live_profile()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  INSERT INTO public.profiles (id, status, role, username)
  VALUES (
    NEW.id,
    'pending'::public.member_status,
    'user'::public.member_role,
    COALESCE(NEW.raw_user_meta_data ->> 'username', split_part(COALESCE(NEW.email, ''), '@', 1))
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created_live_profile ON auth.users;
CREATE TRIGGER on_auth_user_created_live_profile
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_live_profile();
