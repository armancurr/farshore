/*
 * What players look like to each other: five characters, three skins each.
 * The marketplace sells them; for now every skin is free, so `price` is only
 * what it will cost once the market is gated behind coins.
 */

export const CHARACTERS = ["wanderer", "lantern", "diver", "corsair", "buoy"] as const;

export type CharacterId = (typeof CHARACTERS)[number];

export type SkinDef = {
  id: string;
  character: CharacterId;
  /* Which of the character's three looks. */
  variant: 0 | 1 | 2;
  name: string;
  price: number;
};

/* In marketplace order: one row per character. */
export const SKINS = [
  { id: "wanderer-skull", character: "wanderer", variant: 0, name: "Skull Mask", price: 0 },
  { id: "wanderer-gull", character: "wanderer", variant: 1, name: "Gull Beak", price: 180 },
  { id: "wanderer-slit", character: "wanderer", variant: 2, name: "Slit Visor", price: 240 },
  { id: "lantern-cage", character: "lantern", variant: 0, name: "Caged Lantern", price: 220 },
  { id: "lantern-candle", character: "lantern", variant: 1, name: "Candlewick", price: 260 },
  { id: "lantern-bottle", character: "lantern", variant: 2, name: "Message Bottle", price: 320 },
  { id: "diver-ports", character: "diver", variant: 0, name: "Three-Port Helm", price: 200 },
  { id: "diver-bowl", character: "diver", variant: 1, name: "Fishbowl", price: 280 },
  { id: "diver-abyss", character: "diver", variant: 2, name: "Abyss Lamp", price: 340 },
  { id: "corsair-tricorn", character: "corsair", variant: 0, name: "Tricorn", price: 240 },
  { id: "corsair-kasa", character: "corsair", variant: 1, name: "Straw Kasa", price: 200 },
  { id: "corsair-plume", character: "corsair", variant: 2, name: "Plumed Bicorne", price: 360 },
  { id: "buoy-bands", character: "buoy", variant: 0, name: "Channel Buoy", price: 160 },
  { id: "buoy-light", character: "buoy", variant: 1, name: "Lighthouse", price: 300 },
  { id: "buoy-barnacle", character: "buoy", variant: 2, name: "Barnacled", price: 240 },
] as const satisfies readonly SkinDef[];

export type SkinId = (typeof SKINS)[number]["id"];

/* What a new player wears: the hooded skull the island has always had. */
export const DEFAULT_SKIN: SkinId = "wanderer-skull";

const BY_ID = new Map<string, SkinDef>(SKINS.map((s) => [s.id, s]));

/* Retired skins (and anything else unknown) fail this, so their wearers get the default. */
export const isSkinId = (v: unknown): v is SkinId => typeof v === "string" && BY_ID.has(v);

export const skinDef = (id: SkinId): SkinDef => BY_ID.get(id) as SkinDef;

/*
 * Whether this player may wear the skin. Everything is unlocked while the
 * market is open for free; once skins cost coins, ownership gets checked here.
 */
export const canWear = (id: SkinId) => isSkinId(id);
