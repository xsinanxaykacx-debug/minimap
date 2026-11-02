-- ROLLBACK SQL (manual; do not run as part of deployment rollback):
-- DROP INDEX IF EXISTS public.live_sessions_slot_active_uidx;
-- ALTER TABLE public.live_sessions DROP CONSTRAINT IF EXISTS live_sessions_slot_no_check;
-- ALTER TABLE public.live_sessions DROP COLUMN IF EXISTS slot_no;
-- DROP TABLE IF EXISTS public.live_sessions; -- removes session history; manual approval only.
--
-- One row represents one live publication. Slots 1..10 are assigned atomically
-- by a trigger in the later RLS/guard migration.

CREATE TABLE IF NOT EXISTS public.live_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  slot_no smallint,
  started_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.live_sessions
  ADD COLUMN IF NOT EXISTS slot_no smallint;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'live_sessions_slot_no_check'
      AND conrelid = 'public.live_sessions'::regclass
  ) THEN
    ALTER TABLE public.live_sessions
      ADD CONSTRAINT live_sessions_slot_no_check
      CHECK (slot_no IS NULL OR slot_no BETWEEN 1 AND 10);
  END IF;
END
$$;

-- Unique active slot is the declarative backstop: even a bug in the allocator
-- cannot commit two simultaneously active sessions into the same slot.
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
GRANT SELECT, INSERT, UPDATE ON TABLE public.live_sessions TO authenticated;
