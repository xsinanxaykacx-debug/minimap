-- ROLLBACK SQL (manual; do not run automatically):
-- DROP INDEX IF EXISTS public.live_sessions_slot_active_uidx;
-- ALTER TABLE public.live_sessions DROP CONSTRAINT IF EXISTS live_sessions_slot_no_check;
-- DROP TABLE IF EXISTS public.live_sessions; -- removes session history; manual approval only.
--
-- slot_no is always populated by the BEFORE INSERT allocator trigger in migration 1903.
-- lat/lng in this table are ALREADY jittered. Raw coordinates live in
-- live_session_locations_private and are not exposed to authenticated clients.

CREATE TABLE IF NOT EXISTS public.live_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  pin_id uuid NOT NULL,
  room_id uuid,
  slot_no smallint NOT NULL,
  lat double precision NOT NULL,
  lng double precision NOT NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.live_sessions
  ADD COLUMN IF NOT EXISTS pin_id uuid;
ALTER TABLE public.live_sessions
  ADD COLUMN IF NOT EXISTS room_id uuid;
ALTER TABLE public.live_sessions
  ADD COLUMN IF NOT EXISTS lat double precision;
ALTER TABLE public.live_sessions
  ADD COLUMN IF NOT EXISTS lng double precision;
ALTER TABLE public.live_sessions
  ADD COLUMN IF NOT EXISTS slot_no smallint;

-- Fail closed if a pre-existing LAB table contains rows that cannot satisfy
-- the required non-null fields. This LAB project was verified empty at review.
ALTER TABLE public.live_sessions
  ALTER COLUMN slot_no SET NOT NULL;
ALTER TABLE public.live_sessions
  ALTER COLUMN pin_id SET NOT NULL;
ALTER TABLE public.live_sessions
  ALTER COLUMN lat SET NOT NULL;
ALTER TABLE public.live_sessions
  ALTER COLUMN lng SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'live_sessions_slot_no_check'
      AND conrelid = 'public.live_sessions'::regclass
  ) THEN
    ALTER TABLE public.live_sessions
      ADD CONSTRAINT live_sessions_slot_no_check
      CHECK (slot_no BETWEEN 1 AND 10);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'live_sessions_lat_check'
      AND conrelid = 'public.live_sessions'::regclass
  ) THEN
    ALTER TABLE public.live_sessions
      ADD CONSTRAINT live_sessions_lat_check CHECK (lat BETWEEN -90 AND 90);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'live_sessions_lng_check'
      AND conrelid = 'public.live_sessions'::regclass
  ) THEN
    ALTER TABLE public.live_sessions
      ADD CONSTRAINT live_sessions_lng_check CHECK (lng BETWEEN -180 AND 180);
  END IF;
END
$$;

-- NULL is impossible because slot_no is NOT NULL and constrained to 1..10.
-- Ended rows retain their historical slot_no; the partial predicate frees it.
CREATE UNIQUE INDEX IF NOT EXISTS live_sessions_slot_active_uidx
  ON public.live_sessions (slot_no)
  WHERE ended_at IS NULL;

CREATE INDEX IF NOT EXISTS live_sessions_active_last_seen_idx
  ON public.live_sessions (last_seen_at)
  WHERE ended_at IS NULL;

CREATE INDEX IF NOT EXISTS live_sessions_user_active_idx
  ON public.live_sessions (user_id, last_seen_at DESC)
  WHERE ended_at IS NULL;

ALTER TABLE public.live_sessions ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON TABLE public.live_sessions TO authenticated;
GRANT ALL ON TABLE public.live_sessions TO service_role;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.live_sessions FROM anon, authenticated;
