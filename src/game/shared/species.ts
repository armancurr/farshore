import type { BiomeId } from "./islands";

/*
 * Every animal on the hunting islands. The room simulates them from these
 * numbers; the client draws each with its model. A kill drops a carcass,
 * filed in your pack under the species, for the Guild Board's contracts.
 *
 *   prey      grazes, and bolts from anyone who comes too close or runs at it.
 *   defender  grazes, but squares up and charges anyone who crowds or hits it.
 *   predator  stalks anyone it notices, closes in and bites, and backs off hurt.
 */

export const SPECIES_IDS = [
  "deer",
  "stag",
  "alpaca",
  "horse",
  "donkey",
  "rabbit",
  "fox",
  "goat",
  "ram",
  "boar",
  "bull",
  "wolf",
] as const;

export type SpeciesId = (typeof SPECIES_IDS)[number];

export const isSpeciesId = (v: unknown): v is SpeciesId =>
  typeof v === "string" && (SPECIES_IDS as readonly string[]).includes(v);

export type Role = "prey" | "defender" | "predator";

export type SpeciesDef = {
  name: string;
  plural: string;
  role: Role;
  health: number;
  walk: number;
  run: number;
  /* How close you can get, walking and running, before it notices. */
  notice: number;
  noticeRunning: number;
  /* Body radius, for walls and for being hit. */
  radius: number;
  /* What one bite or charge takes, and how far it reaches. */
  damage: number;
  reach: number;
  /* Seconds between bites (predators). */
  cooldown: number;
  /* What a head is worth to the Guild Board, roughly. */
  value: number;
  note: string;
};

export const SPECIES: Record<SpeciesId, SpeciesDef> = {
  deer: {
    name: "Deer",
    plural: "deer",
    role: "prey",
    health: 28,
    walk: 1.6,
    run: 8.2,
    notice: 9,
    noticeRunning: 20,
    radius: 0.55,
    damage: 0,
    reach: 0,
    cooldown: 0,
    value: 22,
    note: "Skittish; they bolt at the sound of running feet.",
  },
  stag: {
    name: "Stag",
    plural: "stags",
    role: "defender",
    health: 48,
    walk: 1.5,
    run: 8.6,
    notice: 8,
    noticeRunning: 16,
    radius: 0.65,
    damage: 12,
    reach: 1.7,
    cooldown: 0,
    value: 40,
    note: "Proud; crowd one and it lowers its antlers.",
  },
  alpaca: {
    name: "Alpaca",
    plural: "alpacas",
    role: "prey",
    health: 30,
    walk: 1.3,
    run: 6.6,
    notice: 7,
    noticeRunning: 15,
    radius: 0.55,
    damage: 0,
    reach: 0,
    cooldown: 0,
    value: 20,
    note: "Woolly grazers of the open meadow.",
  },
  horse: {
    name: "Wild horse",
    plural: "wild horses",
    role: "prey",
    health: 50,
    walk: 1.8,
    run: 10.5,
    notice: 11,
    noticeRunning: 24,
    radius: 0.75,
    damage: 0,
    reach: 0,
    cooldown: 0,
    value: 38,
    note: "Faster than you'll ever run. Corner one, or catch it resting.",
  },
  donkey: {
    name: "Wild donkey",
    plural: "wild donkeys",
    role: "defender",
    health: 40,
    walk: 1.2,
    run: 7,
    notice: 6,
    noticeRunning: 12,
    radius: 0.6,
    damage: 9,
    reach: 1.5,
    cooldown: 0,
    value: 26,
    note: "Stubborn, and it kicks.",
  },
  rabbit: {
    name: "Rabbit",
    plural: "rabbits",
    role: "prey",
    health: 8,
    walk: 1.4,
    run: 9,
    notice: 7,
    noticeRunning: 16,
    radius: 0.3,
    damage: 0,
    reach: 0,
    cooldown: 0,
    value: 8,
    note: "Quick and small. Hard to hit, easy to carry.",
  },
  fox: {
    name: "Fox",
    plural: "foxes",
    role: "prey",
    health: 18,
    walk: 1.6,
    run: 9.4,
    notice: 10,
    noticeRunning: 20,
    radius: 0.4,
    damage: 0,
    reach: 0,
    cooldown: 0,
    value: 24,
    note: "Sly; it slips away long before you're close.",
  },
  goat: {
    name: "Mountain goat",
    plural: "mountain goats",
    role: "prey",
    health: 26,
    walk: 1.4,
    run: 8,
    notice: 9,
    noticeRunning: 18,
    radius: 0.5,
    damage: 0,
    reach: 0,
    cooldown: 0,
    value: 24,
    note: "Sure-footed; it keeps to the high, steep ground.",
  },
  ram: {
    name: "Wild ram",
    plural: "wild rams",
    role: "defender",
    health: 60,
    walk: 1.3,
    run: 8.4,
    notice: 8,
    noticeRunning: 13,
    radius: 0.6,
    damage: 16,
    reach: 1.7,
    cooldown: 0,
    value: 46,
    note: "Lowers its horns and comes at anyone who crowds it.",
  },
  boar: {
    name: "Boar",
    plural: "boar",
    role: "defender",
    health: 55,
    walk: 1.3,
    run: 9.5,
    notice: 8,
    noticeRunning: 12,
    radius: 0.6,
    damage: 14,
    reach: 1.5,
    cooldown: 0,
    value: 36,
    note: "Bad-tempered, and they charge.",
  },
  bull: {
    name: "Wild bull",
    plural: "wild bulls",
    role: "defender",
    health: 110,
    walk: 1.1,
    run: 9,
    notice: 9,
    noticeRunning: 14,
    radius: 0.95,
    damage: 24,
    reach: 2,
    cooldown: 0,
    value: 80,
    note: "Leave it be and it leaves you be. Mostly.",
  },
  wolf: {
    name: "Wolf",
    plural: "wolves",
    role: "predator",
    health: 45,
    walk: 1.8,
    run: 8.8,
    notice: 22,
    noticeRunning: 30,
    radius: 0.55,
    damage: 10,
    reach: 1.6,
    cooldown: 1.3,
    value: 55,
    note: "Hunts in packs, and it will come for you.",
  },
};

/* What each hunting island holds: species and how many of each. */
export const BIOME_HERDS: Record<BiomeId, Partial<Record<SpeciesId, number>>> = {
  meadow: { deer: 9, rabbit: 9, alpaca: 7, horse: 5, fox: 3 },
  pinewood: { stag: 6, deer: 6, fox: 4, wolf: 5, boar: 5 },
  ridge: { wolf: 9, stag: 4, goat: 6, rabbit: 5 },
  marsh: { boar: 8, donkey: 6, bull: 4, fox: 3 },
  fells: { ram: 7, goat: 6, bull: 4, wolf: 5 },
};

/* The beasts the Guild Board puts a price on: one per island. */
export type AlphaDef = { species: SpeciesId; name: string; biome: BiomeId; reward: number };

export const ALPHAS: readonly AlphaDef[] = [
  { species: "horse", name: "Stormmane", biome: "meadow", reward: 320 },
  { species: "stag", name: "The White Hart", biome: "pinewood", reward: 380 },
  { species: "wolf", name: "Old Greymane", biome: "ridge", reward: 450 },
  { species: "boar", name: "Tuskmother", biome: "marsh", reward: 400 },
  { species: "bull", name: "Ironhorn", biome: "fells", reward: 520 },
];

/* An alpha is this much bigger and tougher than its kind, and always fights. */
export const ALPHA = { scale: 1.7, health: 6, damage: 1.8 };

/* Who can overrun an island in a cull, and where. */
export const CULLS: readonly { species: SpeciesId; biome: BiomeId }[] = [
  { species: "wolf", biome: "pinewood" },
  { species: "wolf", biome: "ridge" },
  { species: "boar", biome: "marsh" },
  { species: "wolf", biome: "fells" },
  { species: "rabbit", biome: "meadow" },
];

export const speciesIndex = (s: SpeciesId) => SPECIES_IDS.indexOf(s);
