-- A point login that cannot sign in any more (the client now orders centrally, or the point or client
-- was deactivated): the access screen explains it instead of the generic message.
CREATE FUNCTION private.point_login_paused()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select exists (select 1 from public.partner_locations l join public.partners p on p.id = l.partner_id
    where l.auth_user_id = (select auth.uid()) and (p.stock_mode <> 'per_location' or not l.active or not p.active))
$function$;
revoke all on function private.point_login_paused() from public, anon;
grant execute on function private.point_login_paused() to authenticated;

CREATE FUNCTION public.point_login_paused()
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$ select private.point_login_paused() $function$;
revoke all on function public.point_login_paused() from public, anon;
grant execute on function public.point_login_paused() to authenticated;
