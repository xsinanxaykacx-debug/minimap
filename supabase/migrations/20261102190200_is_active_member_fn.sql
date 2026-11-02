-- ROLLBACK SQL (manual; do not run automatically):
-- REVOKE EXECUTE ON FUNCTION public.is_active_member() FROM authenticated;
-- DROP FUNCTION IF EXISTS public.is_active_member();
--
-- profiles.status is the only membership source of truth.

CREATE OR REPLACE FUNCTION public.is_active_member()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles AS p
    WHERE p.id = (SELECT auth.uid())
      AND p.status = 'active'::public.member_status
  );
$$;

REVOKE ALL ON FUNCTION public.is_active_member() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_active_member() FROM anon;
GRANT EXECUTE ON FUNCTION public.is_active_member() TO authenticated;
