/*
 * Supabase grants EXECUTE on new public functions to anon and authenticated
 * directly, so revoking from PUBLIC alone leaves them open. Only signed-in
 * players need the username functions; nobody calls the trigger function.
 */
revoke execute on function public.username_available(text) from anon;
revoke execute on function public.claim_username(text) from anon;
revoke execute on function public.handle_auth_user() from anon, authenticated;
