import type { Team } from "./catalogue";
import { SKINS, type SkinId } from "./skins";
import type { WeaponKind } from "./weapons";

/*
 * Your crew: men hired in the marketplace who live on your land. At home
 * they keep a post (a round of the Hearth, a tower or a gate, the village)
 * and fight off raiders, whether you're there or not; called, they follow
 * you, aboard and ashore, and fight what you fight. They never die: knocked
 * out, they wake at the Hearth a while later. The numbers live here, shared,
 * so the room, the marketplace and the tests agree.
 */

/* Coins to hire one man. Dismissing him gives nothing back. */
export const CREW_PRICE = 300;

/* Crew ids start here, clear of the players' own, so a swing or a hit names either. */
export const CREW_ID_BASE = 1_000_000;

/* What the crew's been told: keep to their posts, follow you, or hold one spot. */
export const ORDERS = ["home", "follow", "hold"] as const;
export type Order = (typeof ORDERS)[number];
export const isOrder = (v: unknown): v is Order =>
  typeof v === "string" && (ORDERS as readonly string[]).includes(v);

/* Knocked out this long (seconds) at most; once nobody is fighting near them, a little sooner. */
export const KNOCKOUT_TIME = 45;
export const KNOCKOUT_MIN = 10;

/* A crewman's own name, from this list (it goes over the wire as its place in it). */
export const CREW_NAMES = [
  "Bram",
  "Osric",
  "Tam",
  "Wil",
  "Hob",
  "Jory",
  "Finn",
  "Cade",
  "Aldo",
  "Rook",
  "Gil",
  "Ned",
  "Pell",
  "Wat",
  "Dunn",
  "Edric",
  "Hal",
  "Kit",
  "Lars",
  "Mott",
  "Odo",
  "Piet",
  "Quill",
  "Rafe",
  "Sim",
  "Tobin",
  "Ulf",
  "Vance",
  "Wren",
  "Yorick",
  "Abel",
  "Barnaby",
  "Colm",
  "Dag",
  "Emmet",
  "Fen",
  "Garth",
  "Hugh",
  "Ivo",
  "Jem",
  "Kell",
  "Lorn",
  "Merrick",
  "Nils",
  "Orm",
  "Perrin",
  "Roan",
  "Sten",
] as const;

export const isCrewName = (v: unknown): v is string =>
  typeof v === "string" && (CREW_NAMES as readonly string[]).includes(v);

/* A crewman as his land keeps him: who he is, what he looks like, what he carries. */
export type Hand = { id: number; name: string; skin: SkinId; weapon: WeaponKind | null };

/* A name none of the rest of the crew has, if one's left. */
export function pickName(taken: readonly string[], rng: () => number) {
  const free = CREW_NAMES.filter((n) => !taken.includes(n));
  const from = free.length ? free : CREW_NAMES;
  return from[Math.floor(rng() * from.length)];
}

/* A look unlike his master's, and unlike the rest of the crew's while there are looks to spare. */
export function pickSkin(master: SkinId, taken: readonly SkinId[], rng: () => number): SkinId {
  const others = SKINS.map((s) => s.id).filter((s) => s !== master);
  const fresh = others.filter((s) => !taken.includes(s));
  const from = fresh.length ? fresh : others;
  return from[Math.floor(rng() * from.length)];
}

/*
 * A crewman as everyone sees him: [id, plot id, x, y, z, yaw, FLAG bits,
 * weapon index, stagger, skin index, name index]. His master and colours
 * come from the plot.
 */
export type CrewSnap = [
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
  number,
];

export const skinIndex = (skin: SkinId) => SKINS.findIndex((s) => s.id === skin);
export const skinFromIndex = (i: number): SkinId => (SKINS[i] ?? SKINS[0]).id;
export const nameIndex = (name: string) =>
  Math.max(0, (CREW_NAMES as readonly string[]).indexOf(name));
export const nameFromIndex = (i: number) => CREW_NAMES[i] ?? CREW_NAMES[0];

/* The colour a crewman's name is written in: his land's. */
export const TEAM_TAG: Record<Team, string> = {
  blue: "#8cc4ff",
  red: "#ff9a7a",
  yellow: "#ffd75e",
  green: "#8fe39a",
};

/* Your own crew, as the marketplace and the HUD show them. */
export type CrewView = {
  id: number;
  name: string;
  skin: SkinId;
  weapon: WeaponKind | null;
  down: boolean;
};
