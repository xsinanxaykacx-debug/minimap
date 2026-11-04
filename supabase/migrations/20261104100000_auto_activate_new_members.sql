ALTER TABLE public.profiles
  ALTER COLUMN status SET DEFAULT 'active'::public.member_status;

CREATE OR REPLACE FUNCTION public.handle_new_live_profile()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
BEGIN
  INSERT INTO public.profiles (id, status, role, username)
  VALUES (
    NEW.id,
    'active'::public.member_status,
    'user'::public.member_role,
    COALESCE(
      NULLIF(NEW.raw_user_meta_data ->> 'username', ''),
      NULLIF(split_part(COALESCE(NEW.email, NEW.phone, ''), '@', 1), ''),
      'AYTAR Üyesi'
    )
  )
  ON CONFLICT (id) DO NOTHING;

  RETURN NEW;
END;
$function$;
