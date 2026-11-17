import type { Contract, Payout } from "./missions";
import { SPECIES, SPECIES_IDS, type SpeciesId } from "./species";
import { toWeaponKind, WEAPON_KINDS, WEAPONS, type WeaponKind } from "./weapons";

/*
 * Everything you can own. Stackable items (carcasses, building kits) are
 * counted; tools (weapons) are individual, and the hotbar slots point at them.
 */

export type KitId =
  | "campfire"
  | "chest"
  | "bed"
  | "hut"
  | "cabin"
  | "dock"
  | "rowboat"
  | "desertbike";
export const KIT_IDS: readonly KitId[] = [
  "campfire",
  "chest",
  "bed",
  "hut",
  "cabin",
  "dock",
  "rowboat",
  "desertbike",
];

/* A carcass is filed under the species it came from. */
export type ItemId = SpeciesId | KitId;

type ItemDef = {
  name: string;
  plural: string;
  kind: "game" | "kit";
  note: string;
};

const CARCASSES = Object.fromEntries(
  SPECIES_IDS.map((s) => [
    s,
    {
      name: `${SPECIES[s].name} carcass`,
      plural: `${SPECIES[s].name.toLowerCase()} carcasses`,
      kind: "game",
      note: SPECIES[s].note,
    },
  ]),
) as Record<SpeciesId, ItemDef>;

export const ITEMS: Record<ItemId, ItemDef> = {
  ...CARCASSES,
  desertbike: {
    name: "Desert bike",
    plural: "desert bikes",
    kind: "kit",
    note: "A fast trail machine. Spawn from Marketplace → Vehicles on clear dry ground.",
  },
  campfire: {
    name: "Campfire",
    plural: "campfires",
    kind: "kit",
    note: "Warmth: you heal faster beside it.",
  },
  chest: { name: "Storage chest", plural: "chests", kind: "kit", note: "Keeps your spoils safe." },
  bed: { name: "Bed", plural: "beds", kind: "kit", note: "Rest here, and wake here." },
  hut: { name: "Hut", plural: "huts", kind: "kit", note: "Four walls, a door and a roof." },
  cabin: {
    name: "Cabin",
    plural: "cabins",
    kind: "kit",
    note: "Roomy, with windows and a porch.",
  },
  dock: {
    name: "Dock",
    plural: "docks",
    kind: "kit",
    note: "Walk out over the water, and tie up a boat.",
  },
  rowboat: {
    name: "Rowboat",
    plural: "rowboats",
    kind: "kit",
    note: "Row out to the hunting islands.",
  },
};

export const isItemId = (v: unknown): v is ItemId =>
  typeof v === "string" && Object.hasOwn(ITEMS, v);
export const isKitId = (v: unknown): v is KitId =>
  typeof v === "string" && (KIT_IDS as readonly string[]).includes(v);

/* ---------- tools ---------- */

export type ToolKind = WeaponKind;

type ToolDef = {
  name: string;
  /* The weapon it swings like. */
  weapon: WeaponKind;
};

export const TOOLS: Record<ToolKind, ToolDef> = Object.fromEntries(
  WEAPON_KINDS.map((k) => [k, { name: WEAPONS[k].name, weapon: k }]),
) as Record<ToolKind, ToolDef>;

export const isToolKind = (v: unknown): v is ToolKind =>
  typeof v === "string" && Object.hasOwn(TOOLS, v);

/* A tool kind from a save: a weapon since retired comes back as its heir (see toWeaponKind). */
export const toToolKind = (v: unknown): ToolKind | null => (isToolKind(v) ? v : toWeaponKind(v));

/* A tool you own. `uses` counts down to breaking; -1 never breaks (weapons never do). */
export type Tool = { id: number; kind: ToolKind; uses: number };

/* The belt slot your one weapon lives in: fists, then your weapon, then the rest. */
export const WEAPON_SLOT = 1;

/* ---------- inventory ---------- */

/* Slots on the belt, picked with 1–9. Slot 0 is fists. */
export const HOTBAR = 9;
export const MAX_TOOLS = 12;

export type Inventory = {
  coins: number;
  items: Partial<Record<ItemId, number>>;
  tools: Tool[];
  /* Tool ids per hotbar slot. Slot 0 is always your fists. */
  hotbar: (number | null)[];
  slot: number;
  /* The contract you've taken from the Guild Board. */
  mission: Contract | null;
  /* Alpha bounties and cull shares, waiting to be collected at the board. */
  payouts: Payout[];
  /* The bed you last slept in or set down: where you wake after blacking out. */
  bed: number | null;
};

export function emptyInventory(): Inventory {
  return {
    coins: 0,
    items: {},
    tools: [],
    hotbar: Array<number | null>(HOTBAR).fill(null),
    slot: 0,
    mission: null,
    payouts: [],
    bed: null,
  };
}

export function count(inv: Inventory, id: ItemId) {
  return inv.items[id] ?? 0;
}

export function heldTool(inv: Inventory): Tool | null {
  const id = inv.hotbar[inv.slot];
  return id == null ? null : (inv.tools.find((t) => t.id === id) ?? null);
}
