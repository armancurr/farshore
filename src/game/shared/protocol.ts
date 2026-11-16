import type { Bounty } from "./bounties";
import type { Strike } from "./fishing";
import {
  type AnimalKind,
  type FishId,
  HOTBAR,
  type Inventory,
  isItemId,
  isKitId,
  type ItemId,
  type KitId,
} from "./items";
import type { Prefab } from "./prefabs";
import type { WeaponKind } from "./weapons";

export type RosterEntry = { id: number; name: string };

/* A weapon lying on the ground, waiting for someone to pick it up. */
export type GroundWeapon = {
  id: number;
  kind: WeaponKind;
  x: number;
  y: number;
  z: number;
  uses: number;
};

/* Compact per-player state: [id, x, y, z, yaw, pitch, flags, breath, weapon, stagger]. */
export type PlayerSnap = [
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
];

/* Compact per-animal state: [id, kind, x, y, z, yaw, state, health 0..100]. */
export type AnimalSnap = [number, number, number, number, number, number, number, number];

/* Compact per-boat state: [id, x, z, heading, speed]. */
export type BoatSnap = [number, number, number, number, number];

export const ANIMAL_STATE = {
  graze: 0,
  walk: 1,
  run: 2,
  charge: 3,
  dead: 4,
  alert: 5,
} as const;

export const FLAG = {
  alive: 1,
  sprint: 2,
  grounded: 4,
  wet: 8,
  shove: 16, // mid-swing
  block: 64, // shield raised
  charge: 128, // winding up a hammer or flail
} as const;

export type Spawn = { x: number; y: number; z: number; yaw: number };

export type LineState = "cast" | "bite" | "none";

export type HurtCause = "drowned" | "fall" | "boar" | "hit";

export type WorldInfo = {
  seed: number;
  /* World clock: seconds the island has been running. */
  time: number;
  roster: RosterEntry[];
  weapons: GroundWeapon[];
  board: Bounty[];
  prefabs: Prefab[];
  /* Where you stand right now; null when only watching. */
  you: Spawn | null;
};

export type ServerMsg =
  | { t: "welcome"; id: number; name: string; online: boolean }
  | ({ t: "world" } & WorldInfo)
  | { t: "roster"; roster: RosterEntry[] }
  | {
      t: "snap";
      time: number;
      p: PlayerSnap[];
      a: AnimalSnap[];
      b: BoatSnap[];
      me: {
        health: number;
        breath: number;
        stagger: number;
        dead: boolean;
      } | null;
    }
  | { t: "inv"; inv: Inventory }
  | { t: "board"; offers: Bounty[] }
  /* Something built, or changed (a chest's contents). */
  | { t: "prefab"; prefab: Prefab }
  /* You're in this boat now (or out of it, with null). */
  | { t: "aboard"; boat: number | null }
  | { t: "unprefab"; id: number }
  | { t: "paid"; bounty: Bounty }
  /* Someone's fishing line: where the float sits, and whether something's biting. */
  | { t: "line"; by: number; x: number; z: number; state: LineState }
  /* To the angler alone: strike while the needle is in the window. */
  | ({ t: "bite" } & Strike)
  | { t: "catch"; by: number; fish: FishId | null }
  /* An animal struck; `dead` when that was the end of it. */
  | { t: "ahit"; id: number; kind: AnimalKind; by: number; damage: number; dead: boolean }
  | { t: "hurt"; amount: number; cause: HurtCause }
  | { t: "died"; cause: HurtCause }
  | { t: "impulse"; vx: number; vy: number; vz: number }
  | ({ t: "respawn" } & Spawn)
  | { t: "swing"; by: number; kind: WeaponKind | null; heavy: boolean }
  | {
      t: "hit";
      by: number;
      target: number;
      kind: WeaponKind | null;
      /* The victim's stagger after the hit, and what this hit added. */
      stagger: number;
      added: number;
      blocked: boolean;
      parry: boolean;
      heavy: boolean;
    }
  | { t: "wspawn"; weapon: GroundWeapon }
  | { t: "wtake"; id: number; by: number; kind: WeaponKind }
  | { t: "wbreak"; by: number; kind: WeaponKind }
  | { t: "feed"; text: string }
  | { t: "full" };

export type ClientMsg =
  | { t: "hello"; name?: string; spectate?: boolean }
  | {
      t: "move";
      x: number;
      y: number;
      z: number;
      yaw: number;
      pitch: number;
      vx: number;
      vy: number;
      vz: number;
      flags: number;
      /* Rowing: the boat's heading and speed (its position is yours). */
      boat?: { rot: number; speed: number };
    }
  | { t: "attack"; charge: number; climb: boolean }
  | { t: "stance"; block: boolean; charge: boolean }
  | { t: "interact"; kind: InteractKind; id: number }
  | { t: "slot"; i: number }
  /* Move a tool into a hotbar slot (1 to HOTBAR - 1), or back to the pack with -1. */
  | { t: "equip"; tool: number; slot: number }
  | { t: "drop"; tool: number }
  | { t: "buy"; item: string }
  | { t: "place"; kind: KitId; x: number; z: number; rot: number }
  | { t: "pickup"; id: number }
  /* Move `n` of an item into a chest (or out of it, with a negative n). */
  | { t: "stash"; chest: number; item: ItemId; n: number }
  | { t: "accept"; id: number }
  | { t: "turnin" }
  | { t: "abandon" }
  | { t: "cast"; x: number; z: number }
  /* Strike, `at` seconds after the bite as the angler saw it. */
  | { t: "reel"; at: number };

export type InteractKind = "weapon" | "prefab";
const INTERACT_KINDS: readonly InteractKind[] = ["weapon", "prefab"];

export const round2 = (v: number) => Math.round(v * 100) / 100;

const finite = (v: unknown, limit: number): v is number =>
  typeof v === "number" && Number.isFinite(v) && Math.abs(v) <= limit;

function boatOf(v: unknown) {
  if (!v || typeof v !== "object") return undefined;
  const b = v as Record<string, unknown>;
  return finite(b.rot, 100) && finite(b.speed, 20) ? { rot: b.rot, speed: b.speed } : undefined;
}

const isInt = (v: unknown, min: number, max: number): v is number =>
  typeof v === "number" && Number.isInteger(v) && v >= min && v <= max;
const isId = (v: unknown): v is number => isInt(v, 0, 2 ** 31);

/* Servers never trust a frame: anything malformed is dropped. */
export function parseClientMsg(raw: unknown): ClientMsg | null {
  if (typeof raw !== "string" || raw.length > 512) return null;
  let m: Record<string, unknown>;
  try {
    m = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!m || typeof m !== "object") return null;
  switch (m.t) {
    case "hello":
      return { t: "hello", spectate: m.spectate === true };
    case "attack":
      return {
        t: "attack",
        charge: finite(m.charge, 10) ? Math.max(0, m.charge) : 0,
        climb: m.climb === true,
      };
    case "stance":
      return { t: "stance", block: m.block === true, charge: m.charge === true };
    case "interact":
      if (!INTERACT_KINDS.includes(m.kind as InteractKind) || !isId(m.id)) return null;
      return { t: "interact", kind: m.kind as InteractKind, id: m.id };
    case "slot":
      if (!isInt(m.i, 0, HOTBAR - 1)) return null;
      return { t: "slot", i: m.i };
    case "equip":
      if (!isId(m.tool) || !isInt(m.slot, -1, HOTBAR - 1)) return null;
      return { t: "equip", tool: m.tool, slot: m.slot };
    case "buy":
      return typeof m.item === "string" && m.item.length < 32 ? { t: "buy", item: m.item } : null;
    case "place":
      if (!isKitId(m.kind) || !finite(m.x, 1000) || !finite(m.z, 1000) || !finite(m.rot, 100))
        return null;
      return { t: "place", kind: m.kind, x: m.x, z: m.z, rot: m.rot };
    case "pickup":
      return isId(m.id) ? { t: "pickup", id: m.id } : null;
    case "stash":
      if (!isId(m.chest) || !isItemId(m.item) || !isInt(m.n, -9999, 9999) || m.n === 0) return null;
      return { t: "stash", chest: m.chest, item: m.item, n: m.n };
    case "accept":
      return isId(m.id) ? { t: "accept", id: m.id } : null;
    case "turnin":
      return { t: "turnin" };
    case "abandon":
      return { t: "abandon" };
    case "cast":
      if (!finite(m.x, 1000) || !finite(m.z, 1000)) return null;
      return { t: "cast", x: m.x, z: m.z };
    case "reel":
      return { t: "reel", at: finite(m.at, 60) ? m.at : -1 };
    case "drop":
      if (!isId(m.tool)) return null;
      return { t: "drop", tool: m.tool };
    case "move": {
      const nums = ["x", "y", "z", "yaw", "pitch", "vx", "vy", "vz"] as const;
      for (const k of nums) if (!finite(m[k], 1000)) return null;
      if (!finite(m.flags, 255)) return null;
      return {
        t: "move",
        x: m.x as number,
        y: m.y as number,
        z: m.z as number,
        yaw: m.yaw as number,
        pitch: m.pitch as number,
        vx: m.vx as number,
        vy: m.vy as number,
        vz: m.vz as number,
        flags: (m.flags as number) | 0,
        boat: boatOf(m.boat),
      };
    }
    default:
      return null;
  }
}
