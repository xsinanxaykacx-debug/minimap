-- ROLLBACK SQL (manual; do not run automatically):
-- SELECT cron.unschedule('live-session-stale-cleanup');
-- DROP VIEW IF EXISTS public.live_sessions_public;
-- DROP FUNCTION IF EXISTS public.cleanup_stale_live_sessions();
-- DROP TABLE IF EXISTS public.live_session_locations_private;
-- -- Do not drop pg_cron: it may be used by other jobs in this project.
--
-- Public live_sessions stores only jittered coordinates. Raw coordinates are
-- held in a separate table with no grants for anon/authenticated.
-- PostgreSQL 15+ supports security_invoker views; LAB runs PostgreSQL 17.

CREATE TABLE IF NOT EXISTS public.live_session_locations_private (
  session_id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  pin_id uuid NOT NULL,
  lat double precision NOT NULL CHECK (lat BETWEEN -90 AND 90),
  lng double precision NOT NULL CHECK (lng BETWEEN -180 AND 180),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.live_session_locations_private ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.live_session_locations_private FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.live_session_locations_private TO service_role;

-- A publisher can retrieve their own raw location only through the
-- authenticated Edge Function, which verifies JWT ownership before service access.

CREATE OR REPLACE VIEW public.live_sessions_public
WITH (security_invoker = true)
AS
SELECT
  id,
  user_id,
  lat,
  lng,
  room_id,
  started_at
FROM public.live_sessions
WHERE ended_at IS NULL
  AND last_seen_at >= now() - interval '5 minutes';

GRANT SELECT ON public.live_sessions_public TO authenticated;

-- Views do not have RLS policies. With security_invoker=true, the caller's
-- privileges and the base table's RLS policy are applied to this view.
-- The base-table SELECT policy is defined in migration 1903 and requires
-- public.is_active_member() for every row.

CREATE OR REPLACE FUNCTION public.cleanup_stale_live_sessions()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  affected_rows integer;
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock(74102110);

  UPDATE public.live_sessions
     SET ended_at = pg_catalog.now()
   WHERE ended_at IS NULL
     AND last_seen_at < pg_catalog.now() - interval '5 minutes';

  GET DIAGNOSTICS affected_rows = ROW_COUNT;
  RETURN affected_rows;
END;
$$;

REVOKE ALL ON FUNCTION public.cleanup_stale_live_sessions() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.cleanup_stale_live_sessions() FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cleanup_stale_live_sessions() TO postgres, service_role;

-- Supabase Cron is pg_cron. This creates/updates a named job; the function
-- uses last_seen_at (heartbeat), not started_at, so healthy long broadcasts live.
CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;

SELECT cron.schedule(
  'live-session-stale-cleanup',
  '* * * * *',
  'SELECT public.cleanup_stale_live_sessions();'
);
