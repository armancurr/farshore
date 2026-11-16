/*
 * Invites go out by hand, not by Supabase email, and the island moves off the
 * device into the database.
 *
 * The waitlist is now the guest list. To let someone in:
 *   Table editor -> waitlist -> tick `approved` -> copy `invite_link` into your
 *   own email to them.
 * The link is their key: opening it (on any device, any number of times) signs
 * them in through the redeem-invite edge function. Untick `approved` to shut
 * them out. To make the old link stop working, give them a fresh one:
 *   update waitlist set invite_token = default where email = '...';
 */

-- The guest list ------------------------------------------------------------

alter table public.waitlist
  add column approved boolean not null default false,
  add column invite_token text not null unique
    default replace(gen_random_uuid()::text, '-', ''),
  add column invite_link text generated always as (
    case when approved then 'https://farshore-beta.vercel.app/?invite=' || invite_token end
  ) stored,
  add column last_requested_at timestamptz not null default now(),
  add column first_signed_in_at timestamptz,
  add column last_signed_in_at timestamptz;

comment on column public.waitlist.approved is 'Tick to let them in; untick to shut them out.';
comment on column public.waitlist.invite_link is 'Copy this into your invite email. Appears once approved.';
comment on column public.waitlist.invite_token is 'Set to default to make the current link stop working.';
comment on column public.waitlist.last_requested_at is 'Last time they entered their email on the title screen.';

/* Asking again (lost the email, new device) bumps them up so you notice. */
create or replace function public.join_waitlist(email text)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.waitlist (email)
  values (lower(trim(email)))
  on conflict (email) do update set last_requested_at = now();
$$;

-- Approval lives on the guest list now --------------------------------------

drop trigger on_auth_user_invited on auth.users;

create or replace function public.handle_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.players (id, email)
  values (new.id, new.email)
  on conflict (id) do update set email = excluded.email;
  return new;
end;
$$;

alter table public.players drop column approved;

create function public.player_approved()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.players p
    join public.waitlist w on w.email operator(extensions.=) p.email::extensions.citext
    where p.id = auth.uid() and w.approved
  );
$$;

/* Everything the title screen needs to know about the signed-in player. */
create function public.me()
returns table (approved boolean, username text)
language sql
stable
security definer
set search_path = ''
as $$
  select public.player_approved(), p.username::text
  from public.players p
  where p.id = auth.uid();
$$;

create or replace function public.claim_username(name text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  me public.players;
  wanted text := trim(name);
begin
  select * into me from public.players where id = auth.uid() for update;

  if me.id is null then
    raise exception 'not_signed_in' using errcode = '42501';
  elsif not public.player_approved() then
    raise exception 'not_approved' using errcode = '42501';
  elsif me.username is not null then
    raise exception 'username_locked' using errcode = 'P0001';
  elsif not public.username_is_valid(wanted) then
    raise exception 'username_invalid' using errcode = '22023';
  end if;

  begin
    update public.players
      set username = wanted, username_set_at = now()
      where id = me.id;
  exception when unique_violation then
    raise exception 'username_taken' using errcode = '23505';
  end;

  return wanted;
end;
$$;

-- Islands -------------------------------------------------------------------

/*
 * One saved island per player. `saved_at` is the client's clock (ms) when the
 * save was made; a write only lands if it's newer than what's stored, so a
 * device holding an old copy can't roll the island back.
 */
create table public.islands (
  player_id uuid primary key references public.players (id) on delete cascade,
  data jsonb not null check (pg_column_size(data) < 262144),
  saved_at bigint not null,
  updated_at timestamptz not null default now()
);

alter table public.islands enable row level security;
revoke all on public.islands from anon, authenticated;
grant select on public.islands to authenticated;

create policy "Players can read their own island"
  on public.islands for select
  to authenticated
  using (player_id = (select auth.uid()));

/* True if the island was stored, false if a newer one was already there. */
create function public.put_island(island jsonb, at bigint)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'not_signed_in' using errcode = '42501';
  elsif not public.player_approved() then
    raise exception 'not_approved' using errcode = '42501';
  end if;

  insert into public.islands as i (player_id, data, saved_at)
  values (auth.uid(), island, at)
  on conflict (player_id) do update
    set data = excluded.data, saved_at = excluded.saved_at, updated_at = now()
    where i.saved_at < excluded.saved_at;

  return found;
end;
$$;

-- Grants ----------------------------------------------------------------------

revoke execute on function public.player_approved() from public, anon, authenticated;
revoke execute on function public.me() from public, anon;
revoke execute on function public.put_island(jsonb, bigint) from public, anon;
grant execute on function public.me() to authenticated;
grant execute on function public.put_island(jsonb, bigint) to authenticated;
