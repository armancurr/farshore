/*
 * Creative mode (flying about, nothing hurts you) is for trying things out
 * while developing: it's only there in `bun run dev`, never in a build. The
 * dev server's room is the only one that honours it, too.
 */
export const CREATIVE = import.meta.env.DEV;

/* Where the camera sits: at your eyes, or behind you looking over your shoulders. */
export type CameraView = "first" | "third";

const VIEW_KEY = "farshore:view";

/* The view on foot this browser last chose (first person unless you switched). */
export function readView(): CameraView {
  try {
    if (localStorage.getItem(VIEW_KEY) === "third") return "third";
  } catch {
    /* Storage unavailable. */
  }
  return "first";
}

export function keepView(view: CameraView) {
  try {
    localStorage.setItem(VIEW_KEY, view);
  } catch {
    /* Storage unavailable: it lasts until the tab closes. */
  }
}
