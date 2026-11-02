-- ROLLBACK SQL (manual; only if this migration is intentionally reverted):
-- REVOKE EXECUTE ON FUNCTION public.is_active_member() FROM authenticated;
-- DROP FUNCTION IF EXISTS public.is_active_member();

-- SECURITY DEFINER allows the membership check to read the caller's profile
-- even when profiles RLS is enabled. The fixed empty search_path and fully
-- qualified object names prevent search_path object-shadowing.
CREATE OR REPLACE FUNCTION public.is_active_member()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles p
    WHERE p.id = (SELECT auth.uid())
      AND p.membership_status = 'active'
      AND p.status::text = 'active'
  );
$$;

REVOKE ALL ON FUNCTION public.is_active_member() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_active_member() FROM anon;
GRANT EXECUTE ON FUNCTION public.is_active_member() TO authenticated;
