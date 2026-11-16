import { useSyncExternalStore } from "react";
import { parseSave, type SaveData } from "../game/shared/save";
import { getAuth, subscribeAuth } from "./auth";
import { SUPABASE_KEY, SUPABASE_URL, supabase } from "./supabase";

/*
 * The player's island lives in the database (`islands`), with a copy in
 * localStorage that the game reads and writes synchronously: saving never
 * waits on the network, and a reload starts from the local copy instantly.
 *
 * Every local write is stamped with the time it was made and marked dirty;
 * dirty copies are pushed up a few seconds later (or at once, with keepalive,
 * when the tab is hidden or closed). When a player signs in, the local and
 * stored copies are compared and the newer one wins, so playing on a second
 * device picks up where the first left off. The database refuses a copy older
 * than the one it holds, so a stale device can't roll an island back.
 */

interface Local {
  data: unknown;
  savedAt: number;
  dirty: boolean;
}

const localKey = (userId: string) => `farshore:island:${userId}`;
/* Where the island lived before accounts. Adopted by the first account to sign in here. */
const LEGACY_KEY = "rising-tide:island";
/* Push dirty saves at most this often while playing. */
const UPLOAD_EVERY = 5000;
/* keepalive requests are capped at 64KB in flight. */
const KEEPALIVE_MAX = 60_000;

let userId: string | null = null;
let accessToken: string | null = null;
let synced = false;
const listeners = new Set<() => void>();

function setSynced(next: boolean) {
  if (synced === next) return;
  synced = next;
  for (const listener of listeners) listener();
}

function readLocal(id: string): Local | null {
  try {
    const raw = localStorage.getItem(localKey(id));
    return raw ? (JSON.parse(raw) as Local) : null;
  } catch {
    return null;
  }
}

function writeLocal(id: string, local: Local) {
  try {
    localStorage.setItem(localKey(id), JSON.stringify(local));
  } catch {
    /* Full or blocked: the upload below still carries it. */
  }
}

/* ---- What the game calls --------------------------------------------------- */

/* The signed-in player's island, or null if there isn't one (or nobody's signed in). */
export function readIsland(): SaveData | null {
  if (!userId) return null;
  const local = readLocal(userId);
  if (!local) return null;
  const save = parseSave(local.data);
  if (!save) console.warn("farshore: ignoring a damaged or outdated save; starting fresh.");
  return save;
}

/* Keep the island. `urgent` when the page may be going away: push it now. */
export function writeIsland(save: SaveData, opts: { urgent?: boolean } = {}) {
  if (!userId) return;
  writeLocal(userId, { data: save, savedAt: Date.now(), dirty: true });
  if (opts.urgent) void upload({ keepalive: true });
  else scheduleUpload();
}

/* Throw the island away. The fresh one written right after replaces it upstream too. */
export function clearIsland() {
  if (!userId) return;
  try {
    localStorage.removeItem(localKey(userId));
  } catch {
    /* Nothing to clear. */
  }
}

/* Push anything not yet stored (before signing out, say). */
export async function flushIsland() {
  if (uploadTimer) clearTimeout(uploadTimer);
  uploadTimer = null;
  await upload();
}

/* ---- Keeping the database in step --------------------------------------------- */

let uploadTimer: ReturnType<typeof setTimeout> | null = null;
let uploading = false;

function scheduleUpload() {
  if (uploadTimer) return;
  uploadTimer = setTimeout(() => {
    uploadTimer = null;
    void upload();
  }, UPLOAD_EVERY);
}

async function upload(opts: { keepalive?: boolean } = {}) {
  const id = userId;
  if (!id) return;
  const local = readLocal(id);
  if (!local?.dirty) return;
  /* One at a time; whatever's dirty when it lands goes next. */
  if (uploading && !opts.keepalive) {
    scheduleUpload();
    return;
  }

  const body = JSON.stringify({ island: local.data, at: local.savedAt });
  uploading = true;
  try {
    let ok: boolean;
    if (opts.keepalive && accessToken && body.length < KEEPALIVE_MAX) {
      /* The page may be gone before a normal request finishes. */
      const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/put_island`, {
        method: "POST",
        keepalive: true,
        headers: {
          apikey: SUPABASE_KEY,
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body,
      });
      ok = res.ok;
    } else {
      const { error } = await supabase.rpc("put_island", { island: local.data, at: local.savedAt });
      if (error) console.error(error);
      ok = !error;
    }
    /* Clear dirty only if nothing newer was written meanwhile. */
    const now = readLocal(id);
    if (ok && userId === id && now?.savedAt === local.savedAt)
      writeLocal(id, { ...now, dirty: false });
  } catch (error) {
    /* Offline: it stays dirty and goes up on the next save or the next visit. */
    console.warn("farshore: couldn't save the island upstream yet", error);
  } finally {
    uploading = false;
  }
}

/* Compare this device's copy with the stored one; the newer one wins. */
async function reconcile(id: string) {
  const { data: remote, error } = await supabase
    .from("islands")
    .select("data, saved_at")
    .eq("player_id", id)
    .maybeSingle();
  if (userId !== id) return;
  if (error) {
    /* Can't reach it: play on the local copy and push it when we can. */
    console.error(error);
    setSynced(true);
    return;
  }

  let local = readLocal(id);
  if (!local && !remote) local = adoptLegacy(id);
  const remoteAt = remote ? Number(remote.saved_at) : -1;

  if (remote && (!local || remoteAt > local.savedAt)) {
    writeLocal(id, { data: remote.data, savedAt: remoteAt, dirty: false });
  } else if (local && local.savedAt > remoteAt) {
    if (!local.dirty) writeLocal(id, { ...local, dirty: true });
    void upload();
  }
  setSynced(true);
}

/* The island from before accounts, if this browser has one. */
function adoptLegacy(id: string): Local | null {
  try {
    const raw = localStorage.getItem(LEGACY_KEY);
    if (!raw || !parseSave(JSON.parse(raw))) return null;
    const local = { data: JSON.parse(raw), savedAt: Date.now(), dirty: true };
    writeLocal(id, local);
    localStorage.removeItem(LEGACY_KEY);
    return local;
  } catch {
    return null;
  }
}

/* Follow whoever is signed in. Only approved, named players have an island to sync. */
if (typeof window !== "undefined") {
  const follow = () => {
    const auth = getAuth();
    const next = auth.status === "ready" ? auth.userId : null;
    if (next === userId) return;
    userId = next;
    setSynced(false);
    if (next) void reconcile(next);
  };
  subscribeAuth(follow);
  follow();

  supabase.auth.onAuthStateChange((_event, session) => {
    accessToken = session?.access_token ?? null;
  });
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/* True once the island is ready to load: going ashore waits for this. */
export function useIslandSynced() {
  return useSyncExternalStore(subscribe, () => synced);
}
