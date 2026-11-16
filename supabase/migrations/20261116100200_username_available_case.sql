/*
 * With search_path = '' a bare `=` resolves to text equality, which is
 * case-sensitive. Use citext's own operator so "Arman" and "arman" collide here
 * the same way they do in the unique index.
 */
create or replace function public.username_available(name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.username_is_valid(name)
    and not exists (
      select 1 from public.players p
      where p.username operator(extensions.=) name::extensions.citext
    );
$$;
