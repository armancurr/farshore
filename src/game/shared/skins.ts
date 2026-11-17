/*
 * What players look like to each other: the KayKit adventurers and
 * skeletons, each in a few liveries (recoloured textures, built by
 * scripts/characters.mjs) and with a few pieces of kit left off. The
 * marketplace sells them; for now every skin is free, so `price` is only
 * what it will cost once the market is gated behind coins.
 */

export const CHARACTERS = [
  "rogue-hooded",
  "knight",
  "barbarian",
  "mage",
  "ranger",
  "rogue",
  "skeleton-rogue",
  "skeleton-warrior",
  "skeleton-mage",
  "skeleton-minion",
] as const;

export type CharacterId = (typeof CHARACTERS)[number];

/* The texture each character is painted with when its skin names no livery. */
export const CHARACTER_TEXTURE: Record<CharacterId, string> = {
  "rogue-hooded": "rogue",
  knight: "knight",
  barbarian: "barbarian",
  mage: "mage",
  ranger: "ranger",
  rogue: "rogue",
  "skeleton-rogue": "skeleton",
  "skeleton-warrior": "skeleton",
  "skeleton-mage": "skeleton",
  "skeleton-minion": "skeleton",
};

export type SkinDef = {
  id: string;
  character: CharacterId;
  name: string;
  price: number;
  /* A livery: public/models/characters/<livery>.png in place of the character's own texture. */
  livery?: string;
  /* Pieces of kit left off, by the last part of their node name ("Helmet", "Cape"). */
  hide?: readonly string[];
};

/* In marketplace order: a row or so per character. */
/*
 * For now each character comes in one look; the other liveries are commented
 * out (not deleted) and come back by uncommenting them.
 */
export const SKINS = [
  { id: "wanderer", character: "rogue-hooded", name: "Wanderer", price: 0 },
  //   {
  //     id: "nightjar",
  //     character: "rogue-hooded",
  //     name: "Nightjar",
  //     price: 240,
  //     livery: "rogue-dusk",
  //   },
  //   {
  //     id: "reef-runner",
  //     character: "rogue-hooded",
  //     name: "Reef Runner",
  //     price: 220,
  //     livery: "rogue-coral",
  //     hide: ["Mask"],
  //   },
  { id: "harbor-knight", character: "knight", name: "Harbor Knight", price: 260 },
  //   {
  //     id: "tidewarden",
  //     character: "knight",
  //     name: "Tidewarden",
  //     price: 300,
  //     livery: "knight-tide",
  //     hide: ["HelmetVisor"],
  //   },
  //   {
  //     id: "dusk-paladin",
  //     character: "knight",
  //     name: "Dusk Paladin",
  //     price: 340,
  //     livery: "knight-dusk",
  //   },
  //   {
  //     id: "brass-squire",
  //     character: "knight",
  //     name: "Brass Squire",
  //     price: 160,
  //     livery: "knight-brass",
  //     hide: ["Helmet", "HelmetVisor", "Cape"],
  //   },
  { id: "bear-chief", character: "barbarian", name: "Bear Chief", price: 240 },
  //   {
  //     id: "otter-brawler",
  //     character: "barbarian",
  //     name: "Otter Brawler",
  //     price: 180,
  //     livery: "barbarian-coral",
  //     hide: ["BearHat"],
  //   },
  //   {
  //     id: "snow-bear",
  //     character: "barbarian",
  //     name: "Snow Bear",
  //     price: 280,
  //     livery: "barbarian-snow",
  //   },
  { id: "stargazer", character: "mage", name: "Stargazer", price: 260 },
  //   { id: "sea-witch", character: "mage", name: "Sea Witch", price: 300, livery: "mage-sea" },
  //   { id: "ember-witch", character: "mage", name: "Ember Witch", price: 300, livery: "mage-ember" },
  //   {
  //     id: "apprentice",
  //     character: "mage",
  //     name: "Apprentice",
  //     price: 140,
  //     hide: ["Hat"],
  //   },
  { id: "wayfinder", character: "ranger", name: "Wayfinder", price: 200 },
  //   {
  //     id: "coral-scout",
  //     character: "ranger",
  //     name: "Coral Scout",
  //     price: 240,
  //     livery: "ranger-coral",
  //   },
  //   {
  //     id: "night-warden",
  //     character: "ranger",
  //     name: "Night Warden",
  //     price: 260,
  //     livery: "ranger-dusk",
  //   },
  { id: "cutpurse", character: "rogue", name: "Cutpurse", price: 180 },
  //   {
  //     id: "plum-duelist",
  //     character: "rogue",
  //     name: "Plum Duelist",
  //     price: 220,
  //     livery: "rogue-plum",
  //     hide: ["Cape"],
  //   },
  //   {
  //     id: "lagoon-thief",
  //     character: "rogue",
  //     name: "Lagoon Thief",
  //     price: 200,
  //     livery: "rogue-lagoon",
  //   },
  { id: "grinning-cutthroat", character: "skeleton-rogue", name: "Grinning Cutthroat", price: 260 },
  { id: "bone-sentinel", character: "skeleton-warrior", name: "Bone Sentinel", price: 300 },
  //   {
  //     id: "drowned-sentinel",
  //     character: "skeleton-warrior",
  //     name: "Drowned Sentinel",
  //     price: 340,
  //     livery: "skeleton-drowned",
  //   },
  { id: "shallows-lich", character: "skeleton-mage", name: "Lich of the Shallows", price: 360 },
  //   {
  //     id: "kelp-lich",
  //     character: "skeleton-mage",
  //     name: "Kelp Lich",
  //     price: 380,
  //     livery: "skeleton-drowned",
  //   },
  //   { id: "rattlebones", character: "skeleton-minion", name: "Rattlebones", price: 120 },
  //   {
  //     id: "coral-rattler",
  //     character: "skeleton-minion",
  //     name: "Coral Rattler",
  //     price: 160,
  //     livery: "skeleton-coral",
  //     hide: ["Cloak"],
  //   },
] as const satisfies readonly SkinDef[];

export type SkinId = (typeof SKINS)[number]["id"];

/* What a new player wears: a hooded wanderer, as the island has always had. */
export const DEFAULT_SKIN: SkinId = "wanderer";

const BY_ID = new Map<string, SkinDef>(SKINS.map((s) => [s.id, s]));

/* Retired skins (the old ink rigs, say) and anything else unknown fail this, so their wearers get the default. */
export const isSkinId = (v: unknown): v is SkinId => typeof v === "string" && BY_ID.has(v);

export const skinDef = (id: SkinId): SkinDef => BY_ID.get(id) as SkinDef;

/* The texture a skin is painted with, without its folder or extension. */
export const skinTexture = (id: SkinId) => {
  const s = skinDef(id);
  return s.livery ?? CHARACTER_TEXTURE[s.character];
};

/*
 * Whether this player may wear the skin. Everything is unlocked while the
 * market is open for free; once skins cost coins, ownership gets checked here.
 */
export const canWear = (id: SkinId) => isSkinId(id);
