/*
 * Who may play farshore.
 *
 *   waitlist  emails people leave on the title screen. Write-only for the public.
 *   players   one row per auth user: are they approved, and what are they called.
 *
 * Inviting someone from the dashboard (Authentication -> Users -> Invite) creates
 * their auth user, and the trigger below marks them approved. Flip `approved`
 * off to shut someone out, or on for a user you added another way.
 *
 * Clients can only read their own player row. The username is set once, through
 * claim_username(), and nothing exposed to clients can change it after that.
 */

create extension if not exists citext with schema extensions;

-- Waitlist ------------------------------------------------------------------

create table public.waitlist (
  email extensions.citext primary key
    check (length(email) <= 254 and email::text ~ '^[^\s@]+@[^\s@]+\.[^\s@]+$'),
  created_at timestamptz not null default now()
);

alter table public.waitlist enable row level security;
revoke all on public.waitlist from anon, authenticated;

/* Joining twice is fine and says nothing about whether you were already on it. */
create function public.join_waitlist(email text)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.waitlist (email)
  values (lower(trim(email)))
  on conflict do nothing;
$$;

revoke execute on function public.join_waitlist(text) from public;
grant execute on function public.join_waitlist(text) to anon, authenticated;

-- Players -------------------------------------------------------------------

/* 3-16 letters, digits or underscores; unique regardless of case. */
create function public.username_is_valid(name text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select name ~ '^[A-Za-z0-9_]{3,16}$'
    and lower(name) not in (
      'admin', 'administrator', 'farshore', 'mod', 'moderator', 'staff', 'support',
      'system', 'root', 'null', 'undefined', 'guest', 'player', 'you', 'me'
    );
$$;

create table public.players (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  approved boolean not null default false,
  username extensions.citext unique check (public.username_is_valid(username::text)),
  username_set_at timestamptz,
  created_at timestamptz not null default now()
);

comment on column public.players.approved is 'Only approved players can get into the game.';
comment on column public.players.username is 'Chosen once by the player; permanent.';

alter table public.players enable row level security;
revoke all on public.players from anon, authenticated;
grant select on public.players to authenticated;

create policy "Players can read their own row"
  on public.players for select
  to authenticated
  using (id = (select auth.uid()));

/* Every auth user gets a player row; invited ones start approved. */
create function public.handle_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.players (id, email, approved)
  values (new.id, new.email, new.invited_at is not null)
  on conflict (id) do update
    set email = excluded.email,
        approved = public.players.approved or excluded.approved;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_auth_user();

/* An invite can land on a user that already exists; that approves them too. */
create trigger on_auth_user_invited
  after update of invited_at on auth.users
  for each row
  when (old.invited_at is null and new.invited_at is not null)
  execute function public.handle_auth_user();

/* Anyone already in auth.users before this migration. */
insert into public.players (id, email, approved)
select id, email, invited_at is not null from auth.users
on conflict (id) do nothing;

-- Usernames -----------------------------------------------------------------

create function public.username_available(name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.username_is_valid(name)
    and not exists (
      select 1 from public.players p where p.username = name::extensions.citext
    );
$$;

/*
 * Claim a username for the signed-in player. Errors carry a short code in the
 * message so the client can say what went wrong:
 *   not_signed_in, not_approved, username_locked, username_invalid, username_taken
 */
create function public.claim_username(name text)
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
  elsif not me.approved then
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

revoke execute on function public.username_available(text) from public;
revoke execute on function public.claim_username(text) from public;
revoke execute on function public.handle_auth_user() from public;
grant execute on function public.username_available(text) to authenticated;
grant execute on function public.claim_username(text) to authenticated;
