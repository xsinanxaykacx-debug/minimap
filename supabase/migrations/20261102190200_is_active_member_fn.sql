-- ROLLBACK SQL (manual; do not run as part of deployment rollback):
-- REVOKE EXECUTE ON FUNCTION public.is_active_member() FROM authenticated;
-- DROP FUNCTION IF EXISTS public.is_active_member();
--
-- SECURITY DEFINER is narrowly scoped to a boolean membership predicate.
-- Fixed search_path and qualified names prevent search_path shadowing.

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
      AND p.membership_status = 'active'
      AND p.status::text = 'active'
  );
$$;

REVOKE ALL ON FUNCTION public.is_active_member() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_active_member() FROM anon;
GRANT EXECUTE ON FUNCTION public.is_active_member() TO authenticated;
