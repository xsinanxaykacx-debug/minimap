-- ROLLBACK SQL (manual; do not run as part of deployment rollback):
-- ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_membership_status_check;
-- ALTER TABLE public.profiles DROP COLUMN IF EXISTS membership_status;
-- DROP TABLE IF EXISTS public.profiles; -- only if this migration created it and no data depends on it.
--
-- LAB-only additive membership foundation. This file is not applied by this PR.

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

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS membership_status text;

-- Backfill follows the existing AYTAR status semantics. Existing active members
-- stay active; pending and disabled accounts do not gain access.
UPDATE public.profiles
SET membership_status = CASE status::text
  WHEN 'active' THEN 'active'
  WHEN 'disabled' THEN 'disabled'
  ELSE 'pending'
END
WHERE membership_status IS NULL;

ALTER TABLE public.profiles
  ALTER COLUMN membership_status SET DEFAULT 'pending';

ALTER TABLE public.profiles
  ALTER COLUMN membership_status SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'profiles_membership_status_check'
      AND conrelid = 'public.profiles'::regclass
  ) THEN
    ALTER TABLE public.profiles
      ADD CONSTRAINT profiles_membership_status_check
      CHECK (membership_status IN ('pending', 'active', 'disabled'));
  END IF;
END
$$;

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON TABLE public.profiles TO authenticated;
