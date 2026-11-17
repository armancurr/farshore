import { GRAND_SIZE } from "./constants";
import type { IslandInfo } from "./islands";
import { HOTBAR, type Inventory, isItemId, isKitId, type ItemId, type KitId } from "./items";
import type { BoardState, Payout } from "./missions";
import type { Prefab } from "./prefabs";
import { isSkinId, type SkinId } from "./skins";
import type { SpeciesId } from "./species";
import { isVehicleKind, type VehicleKind } from "./vehicles";
import { isWeaponKind, type WeaponKind } from "./weapons";

export type RosterEntry = { id: number; name: string; skin: SkinId };

/* Compact per-player state: [id, x, y, z, yaw, pitch, flags, weapon, stagger]. */
export type PlayerSnap = [number, number, number, number, number, number, number, number, number];

/* Compact per-animal state: [id, species index, x, y, z, yaw, state, health 0..100, ANIMAL_FLAG bits]. */
export type AnimalSnap = [number, number, number, number, number, number, number, number, number];

export const ANIMAL_FLAG = {
  /* A named beast with a price on its head: bigger, and always fighting. */
  alpha: 1,
  /* Part of an island's overrun, for the cull. */
  cull: 2,
} as const;

/* Compact per-boat state: [id, x, z, heading, speed]. */
export type BoatSnap = [number, number, number, number, number];
/* Bike: id, x, y, z, heading, speed, steering, terrain pitch, lean. */
export type BikeSnap = [number, number, number, number, number, number, number, number, number];

export const ANIMAL_STATE = {
  graze: 0,
  walk: 1,
  run: 2,
  charge: 3,
  dead: 4,
  alert: 5,
  /* Mid-bite or mid-kick. */
  attack: 6,
} as const;

export const FLAG = {
  riding: 512, // Server-owned bike posture; never accepted from a client frame.
  alive: 1,
  sprint: 2,
  grounded: 4,
  wet: 8,
  shove: 16, // mid-swing
  fly: 32, // flying in creative
  block: 64, // shield raised
  charge: 128, // winding up a warhammer or greatsword
  creative: 256, // in creative: nothing hurts you
} as const;

export type Spawn = { x: number; y: number; z: number; yaw: number };

export type HurtCause = "fall" | "animal" | "hit";

export type WorldInfo = {
  /* Every island on the grand map. */
  islands: IslandInfo[];
  /* World clock: seconds the island has been running. */
  time: number;
  roster: RosterEntry[];
  board: BoardState;
  prefabs: Prefab[];
  /* Where you stand right now; null when only watching. */
  you: Spawn | null;
};

export type ServerMsg =
  /* `token` is who you are here: send it back next time to come back as yourself. */
  | { t: "welcome"; id: number; name: string; online: boolean; token: string | null }
  | ({ t: "world" } & WorldInfo)
  /* You've been moved in one step. */
  | ({ t: "warp" } & Spawn)
  | { t: "roster"; roster: RosterEntry[] }
  | {
      t: "snap";
      time: number;
      p: PlayerSnap[];
      a: AnimalSnap[];
      b: BoatSnap[];
      bikes: BikeSnap[];
      me: {
        health: number;
        stagger: number;
        dead: boolean;
      } | null;
    }
  | { t: "inv"; inv: Inventory }
  | { t: "board"; board: BoardState }
  /* Something built, or changed (a chest's contents). */
  | { t: "prefab"; prefab: Prefab }
  /* You're in this boat now (or out of it, with null). */
  | { t: "aboard"; boat: number | null }
  | { t: "unprefab"; id: number }
  /* Coins into your purse at the Guild Board: a contract handed in, or payouts collected. */
  | { t: "paid"; payouts: Payout[] }
  /* An animal struck; `dead` when that was the end of it. */
  | { t: "ahit"; id: number; kind: SpeciesId; by: number; damage: number; dead: boolean }
  /* Big news from the Guild Board, for everyone: an alpha sighted or slain, an island overrun or cleared. */
  | { t: "news"; title: string; sub: string }
  | { t: "hurt"; amount: number; cause: HurtCause }
  /* `by` is who knocked you out, when someone did. */
  | { t: "died"; cause: HurtCause; by: string | null }
  /* A mace's blow: you're slowed for this many seconds. */
  | { t: "daze"; seconds: number }
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
      /* Health it took (0 on the Harbor, in creative, or against a block). */
      damage: number;
      blocked: boolean;
      parry: boolean;
      heavy: boolean;
    }
  | { t: "feed"; text: string }
  | { t: "full" };

export type ClientMsg =
  /*
   * `token` is who you were last time. `own` says it's this tab's own, rather
   * than one borrowed from another tab: an own token takes over a connection
   * still using it (a reload), a borrowed one already in use gets a new identity.
   */
  | {
      t: "hello";
      /* The username you picked on the title screen, shown over your head. */
      name?: string;
      spectate?: boolean;
      token?: string;
      own?: boolean;
      /* The skin you last wore, kept by this browser. */
      skin?: SkinId;
      /* The weapon you last chose, kept by this browser (null: empty-handed). */
      weapon?: WeaponKind | null;
    }
  /* Wear a different skin from the marketplace. */
  | { t: "skin"; skin: SkinId }
  /* Take up a weapon from the marketplace, in place of the one you carry (null: put it away). */
  | { t: "arm"; kind: WeaponKind | null }
  /* Put a vehicle from the marketplace in the water nearby, in place of the last one you spawned. */
  | { t: "spawn"; kind: VehicleKind }
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
      drive?: { forward: number; right: number; brake: boolean };
    }
  | { t: "attack"; charge: number }
  | { t: "stance"; block: boolean; charge: boolean }
  | { t: "interact"; kind: InteractKind; id: number }
  | { t: "slot"; i: number }
  /* Move a tool into a hotbar slot (1 to HOTBAR - 1), or back to the pack with -1. */
  | { t: "equip"; tool: number; slot: number }
  | { t: "buy"; item: string }
  | { t: "place"; kind: KitId; x: number; z: number; rot: number }
  | { t: "pickup"; id: number }
  /* Move `n` of an item into a chest (or out of it, with a negative n). */
  | { t: "stash"; chest: number; item: ItemId; n: number }
  /* The Guild Board: take a contract, hand one in, give one up, collect what you're owed. */
  | { t: "accept"; id: number }
  | { t: "turnin" }
  | { t: "abandon" }
  | { t: "collect" };

export type InteractKind = "prefab";
const INTERACT_KINDS: readonly InteractKind[] = ["prefab"];

export const round2 = (v: number) => Math.round(v * 100) / 100;

/* No position on the grand map is further out than this. */
const COORD = GRAND_SIZE / 2 + 100;

const isToken = (v: unknown): v is string =>
  typeof v === "string" && /^[A-Za-z0-9_-]{8,64}$/.test(v);

/* A username as the name picker allows it: 3–16 letters, numbers or underscores. */
const isPlayerName = (v: unknown): v is string =>
  typeof v === "string" && /^[A-Za-z0-9_]{3,16}$/.test(v);

const finite = (v: unknown, limit: number): v is number =>
  typeof v === "number" && Number.isFinite(v) && Math.abs(v) <= limit;

function boatOf(v: unknown) {
  if (!v || typeof v !== "object") return undefined;
  const b = v as Record<string, unknown>;
  return finite(b.rot, 100) && finite(b.speed, 40) ? { rot: b.rot, speed: b.speed } : undefined;
}

function driveOf(v: unknown) {
  if (!v || typeof v !== "object") return undefined;
  const d = v as Record<string, unknown>;
  return finite(d.forward, 1) && finite(d.right, 1) && typeof d.brake === "boolean"
    ? { forward: d.forward, right: d.right, brake: d.brake }
    : undefined;
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
      return {
        t: "hello",
        name: isPlayerName(m.name) ? m.name : undefined,
        spectate: m.spectate === true,
        token: isToken(m.token) ? m.token : undefined,
        own: m.own === true,
        skin: isSkinId(m.skin) ? m.skin : undefined,
        weapon: m.weapon === null ? null : isWeaponKind(m.weapon) ? m.weapon : undefined,
      };
    case "skin":
      return isSkinId(m.skin) ? { t: "skin", skin: m.skin } : null;
    case "arm":
      if (m.kind !== null && !isWeaponKind(m.kind)) return null;
      return { t: "arm", kind: m.kind };
    case "spawn":
      return isVehicleKind(m.kind) ? { t: "spawn", kind: m.kind } : null;
    case "attack":
      return { t: "attack", charge: finite(m.charge, 10) ? Math.max(0, m.charge) : 0 };
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
      if (!isKitId(m.kind) || !finite(m.x, COORD) || !finite(m.z, COORD) || !finite(m.rot, 100))
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
    case "collect":
      return { t: "collect" };
    case "move": {
      const nums = ["x", "y", "z", "yaw", "pitch", "vx", "vy", "vz"] as const;
      for (const k of nums) if (!finite(m[k], COORD)) return null;
      if (!finite(m.flags, 511)) return null;
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
        drive: driveOf(m.drive),
      };
    }
    default:
      return null;
  }
}
