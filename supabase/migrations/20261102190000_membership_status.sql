-- ROLLBACK SQL (manual; do not run automatically):
-- -- This migration only establishes profiles.status; no duplicated membership column exists.
-- -- If this migration created profiles and no data depends on it:
-- -- DROP TABLE IF EXISTS public.profiles;
--
-- LAB-only membership foundation. profiles.status is the single source of truth.

DO $$
BEGIN
  CREATE TYPE public.member_status AS ENUM ('pending', 'active', 'disabled');
EXCEPTION WHEN duplicate_object THEN NULL;
END
$$;

DO $$
BEGIN
  CREATE TYPE public.member_role AS ENUM ('user', 'admin');
EXCEPTION WHEN duplicate_object THEN NULL;
END
$$;

CREATE TABLE IF NOT EXISTS public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  status public.member_status NOT NULL DEFAULT 'pending',
  role public.member_role NOT NULL DEFAULT 'user',
  created_at timestamptz NOT NULL DEFAULT now(),
  username text,
  total_pins_created integer DEFAULT 0,
  total_votes_received integer DEFAULT 0
);

-- No membership_status shadow column: status is canonical.
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON TABLE public.profiles TO authenticated;
