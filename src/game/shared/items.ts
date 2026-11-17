import type { Bounty } from "./bounties";
import { WEAPON_KINDS, WEAPONS, type WeaponKind } from "./weapons";

/*
 * Everything you can own. Stackable items (fish, game, building kits) are
 * counted; tools (weapons and rods) are individual, with wear, and the five
 * hotbar slots point at them.
 */

export type Rarity = "common" | "uncommon" | "rare" | "legendary";
export const RARITIES: readonly Rarity[] = ["common", "uncommon", "rare", "legendary"];

export type FishId =
  | "sprat"
  | "mackerel"
  | "mullet"
  | "bass"
  | "cod"
  | "eel"
  | "moonfish"
  | "lanternfish";
export const FISH_IDS: readonly FishId[] = [
  "sprat",
  "mackerel",
  "mullet",
  "bass",
  "cod",
  "eel",
  "moonfish",
  "lanternfish",
];

export type AnimalKind = "deer" | "boar";
export const ANIMAL_KINDS: readonly AnimalKind[] = ["deer", "boar"];

export type KitId = "campfire" | "chest" | "bed" | "hut" | "cabin" | "dock" | "rowboat";
export const KIT_IDS: readonly KitId[] = [
  "campfire",
  "chest",
  "bed",
  "hut",
  "cabin",
  "dock",
  "rowboat",
];

/* A carcass is filed under the animal it came from. */
export type ItemId = FishId | AnimalKind | KitId | "stick" | "stone" | "dry_fiber" | "wood";

type ItemDef = {
  name: string;
  plural: string;
  kind: "fish" | "game" | "kit" | "resource";
  rarity?: Rarity;
  note: string;
};

export const ITEMS: Record<ItemId, ItemDef> = {
  wood: { name: "Wood", plural: "wood", kind: "resource", note: "Timber cut from a tree." },
  stick: { name: "Stick", plural: "sticks", kind: "resource", note: "A dry branch for crafting." },
  stone: { name: "Stone", plural: "stones", kind: "resource", note: "A small stone for crafting." },
  dry_fiber: {
    name: "Dry fiber",
    plural: "dry fibers",
    kind: "resource",
    note: "Fibers for binding tools.",
  },
  sprat: {
    name: "Sprat",
    plural: "sprats",
    kind: "fish",
    rarity: "common",
    note: "Silver flickers in the shallows.",
  },
  mackerel: {
    name: "Mackerel",
    plural: "mackerel",
    kind: "fish",
    rarity: "common",
    note: "Striped and quick, close to shore.",
  },
  mullet: {
    name: "Grey mullet",
    plural: "grey mullet",
    kind: "fish",
    rarity: "uncommon",
    note: "Grazes the shelf where the sand drops away.",
  },
  bass: {
    name: "Sea bass",
    plural: "sea bass",
    kind: "fish",
    rarity: "uncommon",
    note: "Hunts the middle water.",
  },
  cod: {
    name: "Cod",
    plural: "cod",
    kind: "fish",
    rarity: "uncommon",
    note: "Heavy, and only out in deeper water.",
  },
  eel: {
    name: "Conger eel",
    plural: "conger eels",
    kind: "fish",
    rarity: "rare",
    note: "Comes up from the dark, in deeper water.",
  },
  moonfish: {
    name: "Moonfish",
    plural: "moonfish",
    kind: "fish",
    rarity: "rare",
    note: "A pale disc, far from land.",
  },
  lanternfish: {
    name: "Lanternfish",
    plural: "lanternfish",
    kind: "fish",
    rarity: "legendary",
    note: "Glows in the deep, and seldom bites.",
  },
  deer: {
    name: "Deer carcass",
    plural: "deer carcasses",
    kind: "game",
    note: "Skittish; they bolt at the sound of running feet.",
  },
  boar: {
    name: "Boar carcass",
    plural: "boar carcasses",
    kind: "game",
    note: "Bad-tempered, and they charge.",
  },
  campfire: {
    name: "Campfire",
    plural: "campfires",
    kind: "kit",
    note: "Warmth: you heal faster beside it.",
  },
  chest: { name: "Storage chest", plural: "chests", kind: "kit", note: "Keeps your catch safe." },
  bed: { name: "Bed", plural: "beds", kind: "kit", note: "Rest here, and wake here." },
  hut: { name: "Hut", plural: "huts", kind: "kit", note: "Four walls, a door and a roof." },
  cabin: {
    name: "Cabin",
    plural: "cabins",
    kind: "kit",
    note: "Roomy, with windows and a porch.",
  },
  dock: {
    name: "Fishing dock",
    plural: "docks",
    kind: "kit",
    note: "Walk out over deeper water to fish.",
  },
  rowboat: {
    name: "Rowboat",
    plural: "rowboats",
    kind: "kit",
    note: "Row out to sea, where the rare fish are.",
  },
};

export const isItemId = (v: unknown): v is ItemId =>
  typeof v === "string" && Object.hasOwn(ITEMS, v);
export const isKitId = (v: unknown): v is KitId =>
  typeof v === "string" && (KIT_IDS as readonly string[]).includes(v);

export function rarityRank(r: Rarity) {
  return RARITIES.indexOf(r);
}

/* ---------- tools ---------- */

export type RodDef = {
  /* How far it casts, metres. */
  cast: number;
  /* Seconds to a bite, at least and at most. */
  bite: [number, number];
  /* Multiplies the catch window. */
  window: number;
  /* Shifts the odds toward rarer fish. */
  luck: number;
};

export type ToolKind = WeaponKind | "rod" | "rod2";

type ToolDef = {
  name: string;
  /* The weapon it swings like, or null for a rod. */
  weapon: WeaponKind | null;
  rod?: RodDef;
};

const ARMS = Object.fromEntries(
  WEAPON_KINDS.map((k) => [k, { name: WEAPONS[k].name, weapon: k }]),
) as Record<WeaponKind, ToolDef>;

export const TOOLS: Record<ToolKind, ToolDef> = {
  ...ARMS,
  rod: {
    name: "Driftwood rod",
    weapon: null,
    rod: { cast: 12, bite: [4, 10], window: 1, luck: 0 },
  },
  rod2: {
    name: "Ashwood rod",
    weapon: null,
    rod: { cast: 18, bite: [2.5, 6.5], window: 1.4, luck: 1 },
  },
};

export const isToolKind = (v: unknown): v is ToolKind =>
  typeof v === "string" && Object.hasOwn(TOOLS, v);

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
  /* Item stacks share the belt with tools; counts live in items. */
  itemHotbar: (ItemId | null)[];
  slot: number;
  /* The bounty you've taken from the board. */
  bounty: Bounty | null;
  /* The bed you last slept in or set down: where you wake after blacking out. */
  bed: number | null;
};

export function emptyInventory(): Inventory {
  return {
    coins: 0,
    items: {},
    tools: [],
    hotbar: Array<number | null>(HOTBAR).fill(null),
    itemHotbar: Array<ItemId | null>(HOTBAR).fill(null),
    slot: 0,
    bounty: null,
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
