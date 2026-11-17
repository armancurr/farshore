/*
 * Solo play and local saves are gone: each player's island and position now
 * live with the online grand map on the game server. The per-player island
 * table from the solo days has nothing left to hold.
 */
drop function if exists public.put_island(jsonb, bigint);
drop table if exists public.islands;
