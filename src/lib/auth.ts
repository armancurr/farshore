import type { Session } from "@supabase/supabase-js";
import { useSyncExternalStore } from "react";
import { supabase } from "./supabase";

/*
 * Who is on the title screen, and may they play.
 *
 *   loading     the stored session (or an invite link) is still being read
 *   guest       nobody signed in
 *   unapproved  signed in, but not let in (yet)
 *   naming      approved, still has to pick a username (once, for good)
 *   ready       approved and named: the game is theirs
 *
 * Players get in through the invite link you email them by hand: opening it
 * signs them in (see redeem()). Supabase keeps the session in localStorage, so
 * they stay signed in on that device. Their approval and name are cached there
 * too, so a returning player sees their name the moment the page loads, and
 * the server copy refreshes it right after.
 */
export type AuthStatus = "loading" | "guest" | "unapproved" | "naming" | "ready";

export interface AuthState {
  status: AuthStatus;
  userId: string | null;
  email: string | null;
  username: string | null;
  /*
   * A one-off line for the title screen: a welcome, or why a link didn't work.
   * `openAccess` asks the title screen to put the waitlist card up as well.
   */
  notice: Notice | null;
}

interface Notice {
  id: number;
  text: string;
  tone: "info" | "error";
  openAccess?: boolean;
  /* Stays up until replaced, rather than fading after a few seconds. */
  sticky?: boolean;
}

interface PlayerRow {
  approved: boolean;
  username: string | null;
}

interface CachedPlayer extends PlayerRow {
  id: string;
}

const CACHE_KEY = "farshore-player";

let state: AuthState = {
  status: "loading",
  userId: null,
  email: null,
  username: null,
  notice: null,
};
const listeners = new Set<() => void>();

function set(next: Partial<AuthState>) {
  state = { ...state, ...next };
  for (const listener of listeners) listener();
}

let noticeId = 0;
function notify(
  text: string,
  opts: Omit<Notice, "id" | "text" | "tone"> & { tone?: Notice["tone"] } = {},
) {
  set({ notice: { id: ++noticeId, text, tone: "info", ...opts } });
}

export function dismissNotice() {
  if (state.notice) set({ notice: null });
}

function readCache(id: string): PlayerRow | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    const cached = raw ? (JSON.parse(raw) as CachedPlayer) : null;
    return cached?.id === id ? cached : null;
  } catch {
    return null;
  }
}

function writeCache(row: CachedPlayer | null) {
  try {
    if (row) localStorage.setItem(CACHE_KEY, JSON.stringify(row));
    else localStorage.removeItem(CACHE_KEY);
  } catch {
    /* Private mode and friends: the cache is only a head start. */
  }
}

function statusOf(row: PlayerRow): AuthStatus {
  if (!row.approved) return "unapproved";
  return row.username ? "ready" : "naming";
}

/*
 * An invite link is `/?invite=<token>`. Take the token out of the address bar
 * straight away (so it isn't left in history or shared by accident), then
 * swap it for a session.
 */
const inviteToken = (() => {
  if (typeof window === "undefined") return null;
  const url = new URL(window.location.href);
  const token = url.searchParams.get("invite");
  if (token === null) return null;
  url.searchParams.delete("invite");
  window.history.replaceState(window.history.state, "", url.toString());
  return token;
})();

let redeeming = inviteToken !== null;
let fromInvite = false;

async function redeem(token: string) {
  notify("Opening your invite…", { sticky: true });
  try {
    const { data, error } = await supabase.functions.invoke<{
      token_hash: string;
      type: "signup" | "magiclink";
    }>("redeem-invite", { body: { token } });
    if (error || !data?.token_hash) throw error ?? new Error("No token");
    const { error: verifyError } = await supabase.auth.verifyOtp({
      token_hash: data.token_hash,
      type: data.type === "signup" ? "signup" : "magiclink",
    });
    if (verifyError) throw verifyError;
    fromInvite = true;
    dismissNotice();
  } catch (error) {
    console.error(error);
    notify(
      "That invite link doesn't work anymore. Leave your email and we'll send you a fresh one.",
      { tone: "error", openAccess: true },
    );
  } finally {
    redeeming = false;
    /* Settle on whatever session there is now (the new one, or the old one if it failed). */
    const { data } = await supabase.auth.getSession();
    onSession(data.session);
  }
}

let currentUser: string | null = null;
let greeted = false;

async function loadPlayer(session: Session) {
  const id = session.user.id;
  const { data, error } = await supabase.rpc("me").maybeSingle<PlayerRow>();
  /* Signed out (or switched accounts) while this was in flight. */
  if (currentUser !== id) return;
  if (error) {
    console.error(error);
    /* Keep whatever the cache said; only fall back if there was nothing. */
    if (state.status === "loading") set({ status: "unapproved" });
    return;
  }
  const row: PlayerRow = data ?? { approved: false, username: null };
  writeCache({ id, ...row });
  set({ status: statusOf(row), username: row.username });
  greet();
}

/* Say hello once to someone who just came in through their invite. */
function greet() {
  if (greeted || !fromInvite) return;
  if (state.status === "ready" && state.username) {
    greeted = true;
    notify(`Welcome back, ${state.username}`);
  } else if (state.status === "unapproved") {
    greeted = true;
    notify("You're signed in, but you haven't been let in yet", { openAccess: true });
  }
}

function onSession(session: Session | null) {
  /* Mid-invite: hold on "loading" rather than flash the guest screen. */
  if (redeeming) return;
  const id = session?.user.id ?? null;
  if (!session || !id) {
    currentUser = null;
    writeCache(null);
    set({ status: "guest", userId: null, email: null, username: null });
    return;
  }
  const changed = currentUser !== id;
  currentUser = id;
  if (changed) {
    const cached = readCache(id);
    set({
      userId: id,
      email: session.user.email ?? null,
      status: cached ? statusOf(cached) : "loading",
      username: cached?.username ?? null,
    });
  }
  /* Outside the auth callback: supabase-js can deadlock on calls made inside it. */
  setTimeout(() => void loadPlayer(session), 0);
}

if (typeof window !== "undefined") {
  supabase.auth.onAuthStateChange((event, session) => {
    if (event === "TOKEN_REFRESHED") return;
    onSession(session);
  });
  if (inviteToken !== null) void redeem(inviteToken);

  /* Let in while the tab sat open? Check again whenever they come back to it. */
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible" || state.status !== "unapproved") return;
    void supabase.auth.getSession().then(({ data }) => {
      if (data.session) void loadPlayer(data.session);
    });
  });
}

export function subscribeAuth(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getAuth() {
  return state;
}

export function useAuth() {
  return useSyncExternalStore(subscribeAuth, getAuth);
}

/* ---- Getting in ---------------------------------------------------------- */

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isEmail(value: string) {
  return EMAIL.test(value.trim());
}

/*
 * Leave an email on the waitlist. Nothing is sent: you approve people and
 * email them their invite link yourself. Asking again is harmless, and bumps
 * the request so a player who lost their link shows up for you.
 */
export async function joinWaitlist(rawEmail: string) {
  const email = rawEmail.trim().toLowerCase();
  if (!isEmail(email)) throw new Error("That doesn't look like an email");
  const { error } = await supabase.rpc("join_waitlist", { email });
  if (error) {
    console.error(error);
    throw new Error("Couldn't sign you up. Try again.");
  }
}

export async function signOut() {
  await supabase.auth.signOut();
}

/* ---- Usernames ----------------------------------------------------------- */

export const USERNAME = { min: 3, max: 16 };

/* What can be typed at all: anything else is dropped as it's typed. */
export function cleanUsername(value: string) {
  return value
    .replace(/\s+/g, "_")
    .replace(/[^A-Za-z0-9_]/g, "")
    .slice(0, USERNAME.max);
}

/* A first guess from the email, so most people can just press Enter. */
export function suggestUsername(email: string | null) {
  const guess = cleanUsername((email ?? "").split("@")[0].replace(/[.+-]/g, "_"));
  return guess.length >= USERNAME.min ? guess : "";
}

export async function usernameAvailable(name: string): Promise<boolean> {
  const { data, error } = await supabase.rpc("username_available", { name });
  if (error) throw error;
  return data === true;
}

const CLAIM_ERRORS: Record<string, string> = {
  username_taken: "Someone just took that one. Try another.",
  username_invalid: "3–16 letters, numbers or underscores, and not a reserved word.",
  username_locked: "You already have a name.",
  not_approved: "You haven't been let in yet.",
  not_signed_in: "You've been signed out. Sign in again.",
};

export async function claimUsername(name: string) {
  const { data, error } = await supabase.rpc("claim_username", { name });
  if (error) {
    /* Named in another tab, or shut out meanwhile: catch up with the server. */
    if (error.message === "username_locked" || error.message === "not_approved") {
      void supabase.auth.getSession().then(({ data: s }) => s.session && loadPlayer(s.session));
    }
    throw new Error(CLAIM_ERRORS[error.message] ?? "Couldn't save that name. Try again.");
  }
  const username = String(data);
  if (currentUser) writeCache({ id: currentUser, approved: true, username });
  set({ status: "ready", username });
  notify(`Welcome ashore, ${username}`);
  return username;
}
