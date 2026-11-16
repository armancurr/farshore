import { createClient } from "@supabase/supabase-js";

/*
 * The project's URL and publishable key are public by design (they ship in the
 * bundle either way), so they live here as defaults. Env vars override them,
 * e.g. to point a branch at another project.
 */
export const SUPABASE_URL =
  import.meta.env.VITE_SUPABASE_URL ?? "https://emeczozoscszueknyyff.supabase.co";
export const SUPABASE_KEY =
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? "sb_publishable_8Kll9B7Fy-igPH96fu7zaA_MxY50ck7";

/*
 * Sessions come from invite links (see auth.ts), never from the address bar,
 * so the URL isn't read. The session is kept in localStorage and refreshed in
 * the background, so a player stays signed in on their device.
 */
export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false,
    storageKey: "farshore-auth",
  },
});
