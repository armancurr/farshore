import type { Solid } from "./terrain";
import { WEAPON_KINDS, type WeaponKind } from "./weapons";

export type Phase = "idle" | "countdown" | "playing" | "results";

export type Pillar = Solid & { id: number; at: number };

export type RosterEntry = { id: number; name: string; bot: boolean };

export type Placement = { id: number; name: string; bot: boolean; place: number; by?: string };

/* A weapon lying on the ground, waiting for someone to pick it up. */
export type GroundWeapon = {
  id: number;
  kind: WeaponKind;
  x: number;
  y: number;
  z: number;
  uses: number;
};

export type Held = { kind: WeaponKind; uses: number };

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

export const FLAG = {
  alive: 1,
  sprint: 2,
  grounded: 4,
  wet: 8,
  shove: 16, // mid-swing
  player: 32, // taking part in this round (not a spectator)
  block: 64, // shield raised
  charge: 128, // winding up a hammer or flail
} as const;

export type RoundInfo = {
  phase: Phase;
  seed: number;
  /* Round clock (seconds since play began; negative during the countdown). */
  time: number;
  phaseEndsIn: number;
  hurryFrom: number | null;
  roster: RosterEntry[];
  cairnsTaken: number[];
  pillars: Pillar[];
  weapons: GroundWeapon[];
  results: Placement[];
  you: { player: boolean; spawn: { x: number; y: number; z: number; yaw: number } | null };
};

export type ServerMsg =
  | { t: "welcome"; id: number; name: string; online: boolean }
  | ({ t: "round" } & RoundInfo)
  | {
      t: "snap";
      time: number;
      tide: number;
      p: PlayerSnap[];
      me: {
        breath: number;
        stones: number;
        alive: boolean;
        weapon: Held | null;
        stagger: number;
      } | null;
    }
  | { t: "impulse"; vx: number; vy: number; vz: number }
  | { t: "lift"; y: number }
  | { t: "pillar"; pillar: Pillar }
  | { t: "cairn"; id: number; by: number }
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
  | { t: "wtake"; id: number; by: number }
  | { t: "wbreak"; by: number; kind: WeaponKind }
  | { t: "out"; id: number; by: number | null; place: number }
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
    }
  | { t: "attack"; charge: number; climb: boolean }
  | { t: "stance"; block: boolean; charge: boolean }
  | { t: "pick" }
  | { t: "stone" };

export const round2 = (v: number) => Math.round(v * 100) / 100;

const finite = (v: unknown, limit: number): v is number =>
  typeof v === "number" && Number.isFinite(v) && Math.abs(v) <= limit;

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
    case "pick":
      return { t: "pick" };
    case "stone":
      return { t: "stone" };
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
      };
    }
    default:
      return null;
  }
}

export const isWeaponKind = (v: unknown): v is WeaponKind =>
  typeof v === "string" && (WEAPON_KINDS as readonly string[]).includes(v);
