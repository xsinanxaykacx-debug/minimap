-- ROLLBACK SQL (manual; only if this migration is intentionally reverted):
-- DROP TABLE IF EXISTS public.live_sessions;
-- This removes session history. Do not run automatically.

-- A live session is one concurrent publication slot.
-- A session is considered active while ended_at IS NULL and last_seen_at is
-- within the 90-second heartbeat window.
CREATE TABLE IF NOT EXISTS public.live_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  started_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS live_sessions_active_last_seen_idx
  ON public.live_sessions (last_seen_at)
  WHERE ended_at IS NULL;

CREATE INDEX IF NOT EXISTS live_sessions_user_active_idx
  ON public.live_sessions (user_id, last_seen_at DESC)
  WHERE ended_at IS NULL;

ALTER TABLE public.live_sessions ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE ON TABLE public.live_sessions TO authenticated;
