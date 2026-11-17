import { type CatalogueId, isCatalogueId, type ItemSnap } from "./catalogue";
import { GRAND_SIZE } from "./constants";
import { type CrewSnap, type CrewView, isOrder, type Order } from "./crew";
import { type IslandInfo, isPlotShape, type PlotShapeId } from "./islands";
import { HOTBAR, type Inventory } from "./items";
import type { VehicleSnap } from "./drive";
import type { BoardState, Payout } from "./missions";
import { type Captor, isPlotSize, type PlotSizeId } from "./plots";
import type { CaptureState } from "./raids";
import { isSkinId, type SkinId } from "./skins";
import type { SpeciesId } from "./species";
import { isVehicleKind, type VehicleKind } from "./vehicles";
import { toWeaponKind, type WeaponKind } from "./weapons";

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

export type { VehicleSnap };

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
  riding: 512, // Seated in a vehicle: the room sets it, never a client.
  alive: 1,
  sprint: 2,
  grounded: 4,
  wet: 8,
  shove: 16, // mid-swing
  fly: 32, // flying in creative
  block: 64, // shield raised
  charge: 128, // winding up a warhammer or greatsword
  creative: 256, // in creative: nothing hurts you
  raider: 1024, // Raiding someone's land: the room sets it, never a client.
} as const;

/*
 * A plot's standing in a raid, as everyone sees it. `shield` is seconds
 * left on its shield when this was sent (0: none); `captor` is whose colours
 * fly on its Hearth while a raid's shield lasts; `raiders` how many are on it.
 */
export type PlotState = { id: number; shield: number; captor: Captor | null; raiders: number };

/* A Hearth being taken: [plot id, seconds of capture so far, CAPTURE_STATE, raider's member id]. */
export type CaptureSnap = [number, number, CaptureState, number];

export type Spawn = { x: number; y: number; z: number; yaw: number };

export type HurtCause = "fall" | "animal" | "hit" | "drown";

/*
 * What a shot came down on: the ground, the sea, something built, a person,
 * an animal, a hull, a rock or a tree, or nothing (it flew out of range).
 */
export type LandOn = "ground" | "water" | "item" | "body" | "animal" | "ship" | "solid" | "air";

export type WorldInfo = {
  /* Every island on the grand map. */
  islands: IslandInfo[];
  /* World clock: seconds the island has been running. */
  time: number;
  roster: RosterEntry[];
  board: BoardState;
  /* Every vehicle out there, as in a snapshot. */
  vehicles: VehicleSnap[];
  /* What stands on every plot, by the plot's island id. */
  items: [number, ItemSnap[]][];
  /* Every plot's shield and raiders. */
  plots: PlotState[];
  /* Where you stand right now; null when only watching. */
  you: Spawn | null;
};

export type ServerMsg =
  /* `token` is who you are here: send it back next time to come back as yourself. */
  | { t: "welcome"; id: number; name: string; online: boolean; token: string | null }
  | ({ t: "world" } & WorldInfo)
  /* An island raised while you're here (a plot bought), or raised again in its place (one grown). */
  | { t: "island"; info: IslandInfo }
  /* Something set down on a plot, or moved there (the same id). */
  | { t: "item"; plot: number; item: ItemSnap }
  /* Something taken off a plot: sold, or gone. */
  | { t: "unitem"; plot: number; id: number }
  /*
   * Things on the plots whose health or state changed this tick, flat:
   * [id, health, ITEM_STATE bits] for each. Health 0 is rubble.
   */
  | { t: "items"; c: number[] }
  /* Shields and raiders, on every plot: sent whenever any of them changes. */
  | { t: "plots"; plots: PlotState[] }
  /*
   * Your land is being raided: raiders landing on this side of it, or (at
   * the Hearth) starting to take it.
   */
  | { t: "alarm"; plot: number; side: string; raiders: number; at: "shore" | "hearth" }
  /* A blow landed on something built, at (x, y, z): splinters off wood, sparks off stone. */
  | { t: "ihit"; id: number; by: number; x: number; y: number; z: number; damage: number }
  /*
   * Something let fly: an arrow, a cannonball, a keg. `k` is its place in
   * SHOT_KINDS, `p` where it set off and how fast [x, y, z, vx, vy, vz];
   * `by` who loosed it (-1: a defense, whose item is `src`; a ship's helm sends its vehicle as `src`).
   */
  | { t: "shot"; id: number; k: number; p: number[]; by: number; src: number }
  /*
   * Where a shot came down, `at` seconds into its flight; `who` what it hit
   * (a person, an animal, a thing built or a vehicle) and `dmg` what it took.
   * A keg or a smoke bomb only comes to rest there.
   */
  | {
      t: "land";
      id: number;
      p: number[];
      at: number;
      on: LandOn;
      who?: number;
      dmg?: number;
    }
  /* A keg's fuse ran out, here. */
  | { t: "boom"; id: number; p: number[] }
  /* A vehicle took a battering: its hull's health now, out of `max`. */
  | { t: "vhp"; id: number; hp: number; max: number }
  /* A vehicle wrecked: a boat gone down, a car burnt out. */
  | { t: "sunk"; id: number }
  /* You've been moved in one step. */
  | ({ t: "warp" } & Spawn)
  | { t: "roster"; roster: RosterEntry[] }
  | {
      t: "snap";
      time: number;
      p: PlayerSnap[];
      a: AnimalSnap[];
      /* Every vehicle out there (see drive.ts packVehicle). */
      v: VehicleSnap[];
      /* Hearths being taken, or falling back after. */
      cap: CaptureSnap[];
      /* The crews near you (see crew.ts). */
      c: CrewSnap[];
      /* Defenses awake and aiming, flat: [item id, heading, elevation] each. */
      d: number[];
      me: {
        health: number;
        stagger: number;
        dead: boolean;
        /* Carrying a bucket with water in it. */
        water: boolean;
        /* The plot you're raiding, if you are. */
        raid: number | null;
      } | null;
    }
  | { t: "inv"; inv: Inventory }
  /* Your own crew, and what they've been told: sent whenever either changes. */
  | { t: "crew"; order: Order; men: CrewView[] }
  | { t: "board"; board: BoardState }
  /*
   * You're in this vehicle's seat now (seat 0 steers), or out of it with
   * null: then `at` is where you step off, when the room chose it.
   */
  | { t: "aboard"; id: number | null; seat: number; at?: Spawn }
  /* Where your vehicle really is: what you reported didn't add up. */
  | { t: "vfix"; snap: VehicleSnap }
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
  /* Put a vehicle you own in the water or on the ground nearby, in place of your last one. */
  | { t: "spawn"; kind: VehicleKind }
  /* Buy a plot of land from the marketplace and set it down on the open sea, centred on (x, z). */
  | { t: "buyplot"; size: PlotSizeId; shape: PlotShapeId; x: number; z: number }
  /* Grow your plot to a bigger size where it stands, paying the difference. */
  | { t: "growplot"; size: PlotSizeId }
  /*
   * Buy something from the marketplace and set it down on your land at
   * (x, z), turned by `rot`; or, with `move`, pick up one of yours and set it
   * down there instead, for nothing.
   */
  | { t: "place"; kind: CatalogueId; x: number; z: number; rot: number; move?: number }
  /* Sell one of the things on your land back, for half what it cost. */
  | { t: "sell"; id: number }
  /* Pay to mend one of your things at once (rubble too). */
  | { t: "repair"; id: number }
  /* The dev server only: a purse full of coins, for trying things out. */
  | { t: "devcoins" }
  /* Hire a man for your land; or let one go (nothing back). */
  | { t: "hire" }
  | { t: "dismiss"; id: number }
  /* Buy one of your men a weapon (at its price), or take his away (null: fists). */
  | { t: "crewarm"; id: number; kind: WeaponKind | null }
  /* Tell your crew to keep to their posts, follow you, or hold where you stand. */
  | { t: "order"; order: Order }
  /* Buy a vehicle from the marketplace with coins: yours to spawn from then on. */
  | { t: "buyVehicle"; kind: VehicleKind }
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
      /*
       * At the helm: where you've driven it, as RIDE_FIELDS. Your own
       * position is ignored while you ride; the room seats you.
       */
      ride?: number[];
    }
  /* `aim`, for a bow or a throw, is which way you're aiming (a direction), when the view isn't your eyes'. */
  | { t: "attack"; charge: number; aim?: [number, number, number] }
  /* At a ship's helm: fire the broadside to port (-1) or starboard (1), raised this much (radians). */
  | { t: "broadside"; side: -1 | 1; lift: number }
  | { t: "stance"; block: boolean; charge: boolean }
  | { t: "interact"; kind: InteractKind; id: number }
  | { t: "slot"; i: number }
  /* Move a tool into a hotbar slot (1 to HOTBAR - 1), or back to the pack with -1. */
  | { t: "equip"; tool: number; slot: number }
  /* The Guild Board: take a contract, hand one in, give one up, collect what you're owed. */
  | { t: "accept"; id: number }
  | { t: "turnin" }
  | { t: "abandon" }
  | { t: "collect" };

/* What E can be pressed on. Only vehicles, for now. */
export type InteractKind = "vehicle";
const INTERACT_KINDS: readonly InteractKind[] = ["vehicle"];

/* What a driver reports of their vehicle, in this order. */
export const RIDE_FIELDS = [
  "x",
  "y",
  "z",
  "rot",
  "speed",
  "steer",
  "turn",
  "pitch",
  "roll",
  "vy",
  "aux",
] as const;

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

function rideOf(v: unknown) {
  if (!Array.isArray(v) || v.length !== RIDE_FIELDS.length) return undefined;
  return v.every((n) => finite(n, COORD)) ? (v as number[]) : undefined;
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
        weapon: m.weapon === null ? null : (toWeaponKind(m.weapon) ?? undefined),
      };
    case "skin":
      return isSkinId(m.skin) ? { t: "skin", skin: m.skin } : null;
    case "arm": {
      if (m.kind === null) return { t: "arm", kind: null };
      const kind = toWeaponKind(m.kind);
      return kind ? { t: "arm", kind } : null;
    }
    case "spawn":
      return isVehicleKind(m.kind) ? { t: "spawn", kind: m.kind } : null;
    case "buyplot":
      if (!isPlotSize(m.size) || !isPlotShape(m.shape)) return null;
      if (!finite(m.x, COORD) || !finite(m.z, COORD)) return null;
      return { t: "buyplot", size: m.size, shape: m.shape, x: m.x, z: m.z };
    case "growplot":
      return isPlotSize(m.size) ? { t: "growplot", size: m.size } : null;
    case "place":
      if (!isCatalogueId(m.kind) || !finite(m.x, COORD) || !finite(m.z, COORD)) return null;
      if (!finite(m.rot, 100)) return null;
      if (m.move !== undefined && !isId(m.move)) return null;
      return {
        t: "place",
        kind: m.kind,
        x: m.x,
        z: m.z,
        rot: m.rot,
        ...(m.move !== undefined ? { move: m.move as number } : {}),
      };
    case "sell":
      return isId(m.id) ? { t: "sell", id: m.id } : null;
    case "repair":
      return isId(m.id) ? { t: "repair", id: m.id } : null;
    case "devcoins":
      return { t: "devcoins" };
    case "hire":
      return { t: "hire" };
    case "dismiss":
      return isId(m.id) ? { t: "dismiss", id: m.id } : null;
    case "crewarm": {
      if (!isId(m.id)) return null;
      if (m.kind === null) return { t: "crewarm", id: m.id, kind: null };
      const kind = toWeaponKind(m.kind);
      return kind ? { t: "crewarm", id: m.id, kind } : null;
    }
    case "order":
      return isOrder(m.order) ? { t: "order", order: m.order } : null;
    case "attack": {
      const charge = finite(m.charge, 10) ? Math.max(0, m.charge) : 0;
      const a = m.aim;
      const aim =
        Array.isArray(a) && a.length === 3 && a.every((n) => finite(n, 2))
          ? (a as [number, number, number])
          : undefined;
      return aim ? { t: "attack", charge, aim } : { t: "attack", charge };
    }
    case "broadside":
      if (m.side !== 1 && m.side !== -1) return null;
      return { t: "broadside", side: m.side, lift: finite(m.lift, 2) ? m.lift : 0 };
    case "buyVehicle":
      return isVehicleKind(m.kind) ? { t: "buyVehicle", kind: m.kind } : null;
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
        ride: rideOf(m.ride),
      };
    }
    default:
      return null;
  }
}
