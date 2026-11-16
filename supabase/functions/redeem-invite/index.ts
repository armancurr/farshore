/*
 * Turns an invite link into a session. The browser posts the token from
 * `?invite=`; if it belongs to an approved row on the waitlist, this mints a
 * one-time sign-in token for that email (no email is sent) and hands it back
 * (and its type) for the browser to exchange with supabase.auth.verifyOtp().
 *
 * Deployed with verify_jwt off: guests call it, and the invite token is the
 * credential.
 */
import { createClient } from "npm:@supabase/supabase-js@2.119.0";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const TOKEN = /^[0-9a-f]{32}$/;

function reply(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

const admin = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false, autoRefreshToken: false } },
);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST") return reply({ error: "method_not_allowed" }, 405);

  let token: unknown;
  try {
    ({ token } = await req.json());
  } catch {
    return reply({ error: "invalid_invite" }, 400);
  }
  if (typeof token !== "string" || !TOKEN.test(token))
    return reply({ error: "invalid_invite" }, 400);

  const { data: guest, error: lookupError } = await admin
    .from("waitlist")
    .select("email, approved")
    .eq("invite_token", token)
    .maybeSingle();
  if (lookupError) {
    console.error(lookupError);
    return reply({ error: "server_error" }, 500);
  }
  /* Unknown and unapproved look the same from outside. */
  if (!guest?.approved) return reply({ error: "invalid_invite" }, 404);

  const email = String(guest.email);
  let link = await admin.auth.admin.generateLink({ type: "magiclink", email });
  if (link.error) {
    /* First visit: there's no account yet. Make one (confirmed: the invite vouches for it). */
    const created = await admin.auth.admin.createUser({ email, email_confirm: true });
    if (created.error) {
      console.error(link.error, created.error);
      return reply({ error: "server_error" }, 500);
    }
    link = await admin.auth.admin.generateLink({ type: "magiclink", email });
    if (link.error) {
      console.error(link.error);
      return reply({ error: "server_error" }, 500);
    }
  }

  const now = new Date().toISOString();
  const { error: stampError } = await admin
    .from("waitlist")
    .update({ last_signed_in_at: now })
    .eq("invite_token", token);
  if (stampError) console.error(stampError);
  await admin
    .from("waitlist")
    .update({ first_signed_in_at: now })
    .eq("invite_token", token)
    .is("first_signed_in_at", null);

  /*
   * A first visit's link confirms the new account ("signup"); later ones are
   * plain sign-ins ("magiclink"). verifyOtp needs to be told which.
   */
  return reply({
    token_hash: link.data.properties.hashed_token,
    type: link.data.properties.verification_type,
    email,
  });
});
