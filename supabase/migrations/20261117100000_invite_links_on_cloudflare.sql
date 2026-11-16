/*
 * The site moved to one Cloudflare Worker, so invite links point there now.
 * Generated columns can't be altered in place: drop and re-add it (the value
 * is derived, so nothing is lost).
 */
alter table public.waitlist drop column invite_link;

alter table public.waitlist
  add column invite_link text generated always as (
    case when approved then 'https://farshore.armanenv.workers.dev/?invite=' || invite_token end
  ) stored;

comment on column public.waitlist.invite_link is 'Copy this into your invite email. Appears once approved.';
