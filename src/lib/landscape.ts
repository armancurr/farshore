import { useSyncExternalStore } from "react";

/*
 * Phones play sideways. Where the browser allows it (Android Chrome and
 * friends), going ashore takes the page fullscreen and locks it to landscape.
 * iPhones allow neither, so the game asks to be turned instead (see
 * usePortrait).
 */

type LockableOrientation = ScreenOrientation & {
  lock?: (orientation: "landscape") => Promise<void>;
};

export async function enterLandscape() {
  try {
    const root = document.documentElement;
    if (!document.fullscreenElement && root.requestFullscreen)
      await root.requestFullscreen({ navigationUI: "hide" });
    await (screen.orientation as LockableOrientation | undefined)?.lock?.("landscape");
  } catch {
    /* Not allowed here: the turn-your-phone card covers it. */
  }
}

export function exitLandscape() {
  try {
    screen.orientation?.unlock?.();
  } catch {
    /* Nothing was locked. */
  }
  if (document.fullscreenElement) void document.exitFullscreen?.().catch(() => {});
}

const portrait = typeof window === "undefined" ? null : matchMedia("(orientation: portrait)");

function subscribe(fn: () => void) {
  portrait?.addEventListener("change", fn);
  return () => portrait?.removeEventListener("change", fn);
}

/* Whether the screen is taller than it is wide, kept up to date as it turns. */
export function usePortrait() {
  return useSyncExternalStore(
    subscribe,
    () => portrait?.matches ?? false,
    () => false,
  );
}
