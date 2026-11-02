-- ROLLBACK SQL (manual; only if this migration is intentionally reverted):
-- DROP POLICY IF EXISTS live_sessions_select_own ON public.live_sessions;
-- DROP POLICY IF EXISTS live_sessions_insert_own_member ON public.live_sessions;
-- DROP POLICY IF EXISTS live_sessions_update_own_member ON public.live_sessions;
-- DROP TRIGGER IF EXISTS live_sessions_enforce_global_limit ON public.live_sessions;
-- DROP FUNCTION IF EXISTS public.enforce_live_session_limit();

-- RLS policies are created conditionally so re-running this file is safe.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'profiles'
      AND policyname = 'profiles_select_own'
  ) THEN
    CREATE POLICY profiles_select_own
      ON public.profiles FOR SELECT TO authenticated
      USING (id = (SELECT auth.uid()));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'live_sessions'
      AND policyname = 'live_sessions_select_own'
  ) THEN
    CREATE POLICY live_sessions_select_own
      ON public.live_sessions FOR SELECT TO authenticated
      USING (user_id = (SELECT auth.uid()));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'live_sessions'
      AND policyname = 'live_sessions_insert_own_member'
  ) THEN
    CREATE POLICY live_sessions_insert_own_member
      ON public.live_sessions FOR INSERT TO authenticated
      WITH CHECK (
        user_id = (SELECT auth.uid())
        AND (SELECT public.is_active_member())
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'live_sessions'
      AND policyname = 'live_sessions_update_own_member'
  ) THEN
    CREATE POLICY live_sessions_update_own_member
      ON public.live_sessions FOR UPDATE TO authenticated
      USING (
        user_id = (SELECT auth.uid())
        AND (SELECT public.is_active_member())
      )
      WITH CHECK (
        user_id = (SELECT auth.uid())
        AND (SELECT public.is_active_member())
      );
  END IF;
END
$$;

-- The DB is the final concurrency guard. Advisory transaction locking makes
-- simultaneous starts serialize, so two concurrent inserts cannot both pass
-- a stale COUNT(*) and exceed the global limit of 10.
CREATE OR REPLACE FUNCTION public.enforce_live_session_limit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  active_count integer;
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.started_at := pg_catalog.now();
    NEW.last_seen_at := pg_catalog.now();
    NEW.ended_at := NULL;

    PERFORM pg_catalog.pg_advisory_xact_lock(74102110);

    SELECT pg_catalog.count(*)::integer
      INTO active_count
    FROM public.live_sessions s
    WHERE s.ended_at IS NULL
      AND s.last_seen_at >= pg_catalog.now() - interval '90 seconds';

    IF active_count >= 10 THEN
      RAISE EXCEPTION 'Live session limit reached (10)'
        USING ERRCODE = 'P0001';
    END IF;

  ELSE
    IF OLD.ended_at IS NOT NULL AND NEW.ended_at IS NULL THEN
      NEW.started_at := pg_catalog.now();
      NEW.last_seen_at := pg_catalog.now();

      PERFORM pg_catalog.pg_advisory_xact_lock(74102110);

      SELECT pg_catalog.count(*)::integer
        INTO active_count
      FROM public.live_sessions s
      WHERE s.id <> OLD.id
        AND s.ended_at IS NULL
        AND s.last_seen_at >= pg_catalog.now() - interval '90 seconds';

      IF active_count >= 10 THEN
        RAISE EXCEPTION 'Live session limit reached (10)'
          USING ERRCODE = 'P0001';
      END IF;
    ELSIF NEW.ended_at IS NULL THEN
      -- Active-session updates are heartbeats; clients cannot extend an
      -- arbitrary timestamp or spoof a future last_seen_at value.
      NEW.last_seen_at := pg_catalog.now();
    ELSE
      NEW.ended_at := COALESCE(NEW.ended_at, pg_catalog.now());
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_trigger
    WHERE tgname = 'live_sessions_enforce_global_limit'
      AND tgrelid = 'public.live_sessions'::regclass
      AND NOT tgisinternal
  ) THEN
    CREATE TRIGGER live_sessions_enforce_global_limit
      BEFORE INSERT OR UPDATE ON public.live_sessions
      FOR EACH ROW
      EXECUTE FUNCTION public.enforce_live_session_limit();
  END IF;
END
$$;
