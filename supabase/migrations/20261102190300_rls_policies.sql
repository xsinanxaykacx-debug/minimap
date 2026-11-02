-- ROLLBACK SQL (manual; do not run as part of deployment rollback):
-- DROP POLICY IF EXISTS profiles_select_own ON public.profiles;
-- DROP POLICY IF EXISTS live_sessions_select_own ON public.live_sessions;
-- DROP POLICY IF EXISTS live_sessions_insert_own_active_member ON public.live_sessions;
-- DROP POLICY IF EXISTS live_sessions_update_own_active_member ON public.live_sessions;
-- DROP TRIGGER IF EXISTS live_sessions_allocate_slot ON public.live_sessions;
-- REVOKE ALL ON FUNCTION public.allocate_live_session_slot() FROM PUBLIC, anon, authenticated;
-- DROP FUNCTION IF EXISTS public.allocate_live_session_slot();
--
-- RLS limits row ownership and membership. The trigger serializes allocation;
-- the partial unique index in the preceding migration is the final race-safe
-- invariant for active slots 1..10.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'profiles'
      AND policyname = 'profiles_select_own'
  ) THEN
    CREATE POLICY profiles_select_own
      ON public.profiles FOR SELECT TO authenticated
      USING (id = (SELECT auth.uid()));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'live_sessions'
      AND policyname = 'live_sessions_select_own'
  ) THEN
    CREATE POLICY live_sessions_select_own
      ON public.live_sessions FOR SELECT TO authenticated
      USING (user_id = (SELECT auth.uid()));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'live_sessions'
      AND policyname = 'live_sessions_insert_own_active_member'
  ) THEN
    CREATE POLICY live_sessions_insert_own_active_member
      ON public.live_sessions FOR INSERT TO authenticated
      WITH CHECK (
        user_id = (SELECT auth.uid())
        AND (SELECT public.is_active_member())
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'live_sessions'
      AND policyname = 'live_sessions_update_own_active_member'
  ) THEN
    CREATE POLICY live_sessions_update_own_active_member
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

CREATE OR REPLACE FUNCTION public.allocate_live_session_slot()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  chosen_slot smallint;
BEGIN
  IF TG_OP = 'INSERT' THEN
    -- All competing starts take the same transaction-scoped lock. A second
    -- transaction waits, then sees the first transaction's committed slot.
    PERFORM pg_catalog.pg_advisory_xact_lock(74102110);

    -- Reclaim abandoned sessions after the 90-second heartbeat grace period.
    -- Their slot is released by setting ended_at; this UPDATE re-enters this
    -- trigger, where the UPDATE branch below handles it without re-locking.
    UPDATE public.live_sessions AS s
       SET ended_at = pg_catalog.now(),
           slot_no = NULL
     WHERE s.ended_at IS NULL
       AND s.last_seen_at < pg_catalog.now() - interval '90 seconds';

    SELECT candidate.slot_no
      INTO chosen_slot
    FROM pg_catalog.generate_series(1, 10) AS candidate(slot_no)
    WHERE NOT EXISTS (
      SELECT 1
      FROM public.live_sessions AS s
      WHERE s.slot_no = candidate.slot_no
        AND s.ended_at IS NULL
    )
    ORDER BY candidate.slot_no
    LIMIT 1;

    IF chosen_slot IS NULL THEN
      RAISE EXCEPTION 'Live publication limit reached (10)'
        USING ERRCODE = 'P0001';
    END IF;

    NEW.slot_no := chosen_slot;
    NEW.started_at := pg_catalog.now();
    NEW.last_seen_at := pg_catalog.now();
    NEW.ended_at := NULL;
    RETURN NEW;
  END IF;

  -- The client cannot move a session to another slot, change its owner,
  -- or resurrect an ended session.
  IF NEW.user_id IS DISTINCT FROM OLD.user_id THEN
    RAISE EXCEPTION 'Session owner cannot be changed'
      USING ERRCODE = '42501';
  END IF;

  IF OLD.ended_at IS NOT NULL AND NEW.ended_at IS NULL THEN
    RAISE EXCEPTION 'Ended sessions cannot be reactivated; create a new session'
      USING ERRCODE = 'P0001';
  END IF;

  IF NEW.ended_at IS NOT NULL THEN
    NEW.slot_no := NULL;
    NEW.ended_at := COALESCE(NEW.ended_at, pg_catalog.now());
  ELSE
    NEW.slot_no := OLD.slot_no;
    NEW.last_seen_at := pg_catalog.now();
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.allocate_live_session_slot() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.allocate_live_session_slot() FROM anon;
REVOKE ALL ON FUNCTION public.allocate_live_session_slot() FROM authenticated;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'live_sessions_allocate_slot'
      AND tgrelid = 'public.live_sessions'::regclass
      AND NOT tgisinternal
  ) THEN
    CREATE TRIGGER live_sessions_allocate_slot
      BEFORE INSERT OR UPDATE ON public.live_sessions
      FOR EACH ROW
      EXECUTE FUNCTION public.allocate_live_session_slot();
  END IF;
END
$$;
