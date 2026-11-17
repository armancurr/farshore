import { MODEL_BOUNDS, type ModelId } from "./models.gen";
import { LEAF_PALETTE } from "./nature";

/*
 * Everything ready-made the marketplace sells for your land: houses, walls,
 * towers, jetties, siege engines, trees. Each comes whole, as one or more pack
 * models set out in the item's own space (origin at the middle of its
 * footprint on the ground, front toward +z), with a few boxes and cylinders
 * for collision. Walls run along local x, so their two ends are at ±hx.
 *
 * The packs are miniatures: KayKit's medieval buildings read right at about
 * ×5, the Kenney castle kit at ×4 (see docs/catalogue-models.md).
 */

export const SHELF_IDS = [
  "homes",
  "village",
  "walls",
  "towers",
  "harbour",
  "defenses",
  "nature",
] as const;
export type ShelfId = (typeof SHELF_IDS)[number];

export const SHELVES: Record<ShelfId, string> = {
  homes: "Homes",
  village: "Village",
  walls: "Walls",
  towers: "Towers",
  harbour: "Harbour",
  defenses: "Defenses",
  nature: "Nature",
};

/* Wood burns in a raid; stone doesn't. */
export type Material = "wood" | "stone";

/* Team colours: roofs, banners and trim on the KayKit and castle models. */
export const TEAMS = ["blue", "red", "yellow", "green"] as const;
export type Team = (typeof TEAMS)[number];

/* One pack model in an item, placed in the item's own space. */
export type Piece = {
  model: ModelId;
  x: number;
  y: number;
  z: number;
  rot: number;
  scale: number;
  /* Flattened to this share of its height: what's left of a hedge or a field once it's gone. */
  squash?: number;
  /* A palette of its own (a tree's leaves); otherwise its pack's, in the owner's team colour. */
  palette?: string;
};

/*
 * Something that puts out fires round it by itself (a water barrel, a
 * well): anything burning within `radius` m is doused, one charge at a time,
 * and each charge comes back after `refill` seconds.
 */
export type Douse = { radius: number; charges: number; refill: number };

/*
 * Collision, in the item's own space: a box (half extents along local x and
 * z) or an upright cylinder, from `bottom` (default a little underground) to `top`.
 */
export type Collider = {
  x: number;
  z: number;
  bottom: number;
  top: number;
  stand: boolean;
} & ({ box: { hx: number; hz: number; rot: number } } | { r: number });

/*
 * Where it may stand: on dry land (a beach is fine), or a jetty, whose back
 * end is on the beach and the rest out over the shallows, its deck at DECK.
 */
export type Placing = "land" | "shore";

export type CatalogueItem = {
  id: CatalogueId;
  name: string;
  shelf: ShelfId;
  price: number;
  material: Material;
  /* How much battering it takes. */
  health: number;
  note: string;
  pieces: Piece[];
  /* What's left once it's knocked down or burnt out: a ruin, a pile, a bare trunk. */
  rubble: Piece[];
  douse: Douse | null;
  colliders: Collider[];
  /* Half the footprint along local x and z, and how tall it stands. */
  hx: number;
  hz: number;
  top: number;
  placing: Placing;
  /* A wall segment: snaps end to end with other walls. */
  wall: boolean;
  /* A post (a corner, a tower) that walls run into: snaps onto wall ends. */
  post: boolean;
};

/* A jetty's deck stands this far above the sea, a step up from the beach. */
export const DECK = 0.95;

/* ---------- authoring ---------- */

type PieceDef = Partial<Omit<Piece, "model" | "scale">> & { model: ModelId; scale?: number };

type ColliderDef =
  | {
      box: [number, number];
      at?: [number, number];
      rot?: number;
      top?: number;
      bottom?: number;
      stand?: boolean;
    }
  | { cyl: number; at?: [number, number]; top?: number; bottom?: number; stand?: boolean };

type Def = {
  name: string;
  shelf: ShelfId;
  price: number;
  material: Material;
  health: number;
  note: string;
  /* The scale every piece takes unless it says otherwise. */
  scale: number;
  pieces: PieceDef[];
  /* Default: one box over most of the footprint, full height. "none" walks through. */
  colliders?: ColliderDef[] | "none";
  /* A footprint of its own (a tree's trunk, not its crown); the pieces are then left where they are. */
  foot?: [number, number];
  placing?: Placing;
  wall?: boolean;
  post?: boolean;
  douse?: Douse;
};

/* KayKit buildings and the Kenney castle kit, in metres. */
const K = 5;
const KC = 4;
const Q = Math.PI / 2;

/* Two wall pieces either side of a doorway `gap` wide, under a lintel from `lintel` up. */
function gate(
  len: number,
  thick: number,
  top: number,
  gap: number,
  lintel?: number,
): ColliderDef[] {
  const side = (len - gap) / 4;
  const out: ColliderDef[] = [
    { box: [side, thick], at: [-(gap / 2 + side), 0], top, stand: true },
    { box: [side, thick], at: [gap / 2 + side, 0], top, stand: true },
  ];
  if (lintel !== undefined)
    out.push({ box: [gap / 2, thick], at: [0, 0], bottom: lintel, top, stand: true });
  return out;
}

const DEFS = {
  /* ---------- homes ---------- */
  tent: {
    name: "Bell tent",
    shelf: "homes",
    price: 150,
    material: "wood",
    health: 120,
    note: "Canvas on poles. A roof for the first night ashore.",
    scale: 3.9,
    pieces: [{ model: "camp/tent-canvas" }],
  },
  cottage: {
    name: "Cottage",
    shelf: "homes",
    price: 450,
    material: "wood",
    health: 500,
    note: "Timber on a stone footing, with a chimney.",
    scale: K,
    pieces: [{ model: "buildings/home-a" }],
  },
  house: {
    name: "Townhouse",
    shelf: "homes",
    price: 800,
    material: "wood",
    health: 750,
    note: "Two storeys under a steep roof.",
    scale: K,
    pieces: [{ model: "buildings/home-b" }],
  },
  tavern: {
    name: "Tavern",
    shelf: "homes",
    price: 1200,
    material: "wood",
    health: 900,
    note: "Rooms upstairs and a giant barrel out front.",
    scale: K,
    pieces: [{ model: "buildings/tavern" }],
  },
  chapel: {
    name: "Chapel",
    shelf: "homes",
    price: 1500,
    material: "wood",
    health: 1000,
    note: "A timber hall under a tall steeple, seen from far out at sea.",
    scale: K,
    pieces: [{ model: "buildings/church" }],
  },

  /* ---------- village ---------- */
  well: {
    name: "Well",
    shelf: "village",
    price: 220,
    material: "stone",
    health: 600,
    note: "A stone ring under a little timber roof. Puts out fires nearby, and fills buckets.",
    scale: K,
    pieces: [{ model: "buildings/well" }],
    douse: { radius: 15, charges: 6, refill: 40 },
  },
  stall: {
    name: "Market stall",
    shelf: "village",
    price: 140,
    material: "wood",
    health: 200,
    note: "A striped awning over a counter.",
    scale: 3,
    pieces: [{ model: "town/stall-red" }],
  },
  market: {
    name: "Market",
    shelf: "village",
    price: 900,
    material: "wood",
    health: 700,
    note: "Stalls round a small house: the heart of a village.",
    scale: K,
    pieces: [{ model: "buildings/market" }],
  },
  blacksmith: {
    name: "Blacksmith",
    shelf: "village",
    price: 700,
    material: "wood",
    health: 800,
    note: "A timber shop with a stone forge and an anvil.",
    scale: K,
    pieces: [{ model: "buildings/blacksmith" }],
  },
  lumbermill: {
    name: "Lumber mill",
    shelf: "village",
    price: 900,
    material: "wood",
    health: 700,
    note: "A timber tower with a crane and a saw.",
    scale: K,
    pieces: [{ model: "buildings/lumbermill" }],
  },
  windmill: {
    name: "Windmill",
    shelf: "village",
    price: 1000,
    material: "wood",
    health: 900,
    note: "A stone tower with a timber gallery and sails.",
    scale: K,
    pieces: [{ model: "buildings/windmill" }],
  },
  field: {
    name: "Wheat field",
    shelf: "village",
    price: 120,
    material: "wood",
    health: 150,
    note: "A patch of wheat you can wade through. Burns fast.",
    scale: K,
    pieces: [{ model: "buildings/grain" }],
    colliders: "none",
  },
  lantern: {
    name: "Lantern post",
    shelf: "village",
    price: 30,
    material: "wood",
    health: 60,
    note: "Lights the way in.",
    scale: 1.6,
    pieces: [{ model: "town/lantern" }],
    colliders: [{ cyl: 0.2 }],
  },
  banner: {
    name: "Banner",
    shelf: "village",
    price: 40,
    material: "wood",
    health: 60,
    note: "Your colours on a tall pole.",
    scale: KC,
    pieces: [{ model: "castle/flag" }],
    colliders: [{ cyl: 0.18, at: [0, 0] }],
  },

  /* ---------- walls ---------- */
  palisade: {
    name: "Palisade",
    shelf: "walls",
    price: 40,
    material: "wood",
    health: 250,
    note: "Sharpened stakes, well over head height. Cheap, and it burns.",
    scale: K,
    pieces: [{ model: "buildings/fence-wood-straight", rot: Q }],
    wall: true,
  },
  palisadeGate: {
    name: "Palisade gate",
    shelf: "walls",
    price: 200,
    material: "wood",
    health: 300,
    note: "A timber gate in a run of palisade.",
    scale: K,
    pieces: [{ model: "buildings/fence-wood-straight-gate", rot: Q }],
    colliders: gate(5.77, 0.3, 3.2, 2.6),
    wall: true,
  },
  fence: {
    name: "Stone fence",
    shelf: "walls",
    price: 60,
    material: "stone",
    health: 400,
    note: "A low drystone wall: keeps beasts out, not raiders.",
    scale: K,
    pieces: [{ model: "buildings/fence-stone-straight", rot: Q }],
    wall: true,
  },
  fenceGate: {
    name: "Stone fence gate",
    shelf: "walls",
    price: 120,
    material: "stone",
    health: 400,
    note: "A wooden gate through a low stone wall.",
    scale: K,
    pieces: [{ model: "buildings/fence-stone-straight-gate", rot: Q }],
    colliders: gate(5.77, 0.5, 1.4, 2.4),
    wall: true,
  },
  castleWall: {
    name: "Castle wall",
    shelf: "walls",
    price: 120,
    material: "stone",
    health: 1500,
    note: "Crenellated stone, five metres high. Four metres a segment.",
    scale: KC,
    pieces: [{ model: "castle/wall-narrow", rot: Q }],
    wall: true,
  },
  castleDoor: {
    name: "Castle doorway",
    shelf: "walls",
    price: 220,
    material: "stone",
    health: 1300,
    note: "A castle wall with an arched door through it.",
    scale: KC,
    pieces: [{ model: "castle/wall-doorway", rot: Q }],
    colliders: gate(4, 0.9, 5.24, 1.5, 2.5),
    wall: true,
  },
  castleGate: {
    name: "Castle gate",
    shelf: "walls",
    price: 450,
    material: "stone",
    health: 1600,
    note: "A great arch in the castle wall, wide enough for a cart.",
    scale: KC,
    pieces: [{ model: "castle/wall-narrow-gate", rot: Q }],
    colliders: gate(4, 0.9, 5.24, 2.4, 3.4),
    wall: true,
  },
  corner: {
    name: "Wall corner",
    shelf: "walls",
    price: 60,
    material: "stone",
    health: 1500,
    note: "Caps the joint where two castle walls meet.",
    scale: KC,
    pieces: [{ model: "castle/wall-narrow-corner" }],
    post: true,
  },
  rampart: {
    name: "Rampart",
    shelf: "walls",
    price: 300,
    material: "stone",
    health: 2500,
    note: "Ten metres of thick stone wall with a timber walk along the top.",
    scale: K,
    pieces: [{ model: "buildings/wall-straight" }],
    wall: true,
  },
  rampartGate: {
    name: "Rampart gate",
    shelf: "walls",
    price: 500,
    material: "stone",
    health: 2500,
    note: "A gatehouse in the rampart, double doors and all.",
    scale: K,
    pieces: [{ model: "buildings/wall-straight-gate" }],
    colliders: gate(10, 1.6, 5.5, 3.4, 4.4),
    wall: true,
  },

  /* ---------- towers ---------- */
  watchtower: {
    name: "Watchtower",
    shelf: "towers",
    price: 400,
    material: "wood",
    health: 900,
    note: "A slim stone tower under a timber hoarding: see them coming. The timber burns.",
    scale: KC,
    pieces: [
      { model: "castle/tower-hexagon-base" },
      { model: "castle/tower-hexagon-mid", y: 1.31 * KC },
      { model: "castle/tower-hexagon-top-wood", y: 1.77 * KC },
    ],
  },
  wallTower: {
    name: "Wall tower",
    shelf: "towers",
    price: 450,
    material: "stone",
    health: 2000,
    note: "A square tower as tall as the castle wall, to run walls into.",
    scale: KC,
    pieces: [{ model: "castle/tower-square" }],
    post: true,
  },
  bastion: {
    name: "Bastion",
    shelf: "towers",
    price: 650,
    material: "stone",
    health: 2600,
    note: "A round tower with an open, crenellated top. Ramparts run into it.",
    scale: K,
    pieces: [{ model: "buildings/tower-base" }],
    post: true,
  },
  roundTower: {
    name: "Round tower",
    shelf: "towers",
    price: 900,
    material: "stone",
    health: 2400,
    note: "Tall stone and a conical roof in your colours.",
    scale: K,
    pieces: [{ model: "buildings/tower-a" }],
  },
  spireTower: {
    name: "Castle tower",
    shelf: "towers",
    price: 1300,
    material: "stone",
    health: 3000,
    note: "A square tower of three storeys under a pointed roof.",
    scale: KC,
    pieces: [
      { model: "castle/tower-square-base" },
      { model: "castle/tower-square-mid-windows", y: 1.01 * KC },
      { model: "castle/tower-square-top-roof", y: 2.02 * KC },
    ],
  },
  greatTower: {
    name: "Great tower",
    shelf: "towers",
    price: 1500,
    material: "stone",
    health: 3000,
    note: "Taller still, with a timber gallery under its roof.",
    scale: K,
    pieces: [{ model: "buildings/tower-b" }],
  },
  keep: {
    name: "Keep",
    shelf: "towers",
    price: 1800,
    material: "stone",
    health: 5000,
    note: "A castle keep with turrets and banners: the last place to fall.",
    scale: KC,
    pieces: [{ model: "buildings/castle" }],
  },

  /* ---------- harbour ---------- */
  jetty: {
    name: "Jetty",
    shelf: "harbour",
    price: 350,
    material: "wood",
    health: 500,
    note: "Twelve metres of planking out over the water from the beach.",
    scale: 1,
    pieces: [0, 1, 2, 3, 4].map((k) => ({
      model: "coast/structure-platform-dock" as ModelId,
      z: -4.8 + k * 2.4,
      rot: Math.PI,
    })),
    colliders: [{ box: [1.2, 6], top: DECK, bottom: -3, stand: true }],
    placing: "shore",
  },
  landing: {
    name: "Landing stage",
    shelf: "harbour",
    price: 200,
    material: "wood",
    health: 300,
    note: "A short run of planks for a rowboat to come alongside.",
    scale: 1,
    pieces: [0, 1, 2].map((k) => ({
      model: "coast/structure-platform-dock-small" as ModelId,
      z: -2.4 + k * 2.4,
      rot: Math.PI,
    })),
    colliders: [{ box: [0.9, 3.6], top: DECK, bottom: -3, stand: true }],
    placing: "shore",
  },
  shelter: {
    name: "Net shelter",
    shelf: "harbour",
    price: 450,
    material: "wood",
    health: 450,
    note: "A round roof on posts over the beach, for nets and oars.",
    scale: 1.6,
    pieces: [{ model: "coast/structure-roof" }],
    colliders: [
      { cyl: 0.3, at: [-2.2, -2.3] },
      { cyl: 0.3, at: [2.2, -2.3] },
      { cyl: 0.3, at: [-2.2, 2.3] },
      { cyl: 0.3, at: [2.2, 2.3] },
    ],
  },
  cargo: {
    name: "Cargo",
    shelf: "harbour",
    price: 40,
    material: "wood",
    health: 100,
    note: "Crates and barrels waiting on the quay.",
    scale: 1,
    pieces: [
      { model: "coast/crate", x: -0.7, z: 0.2 },
      { model: "coast/crate", x: -0.7, y: 0.77, z: 0.2, rot: 0.3 },
      { model: "coast/barrel", x: 1, z: -0.3, scale: 0.85 },
      { model: "coast/barrel", x: 1.2, z: 0.9, scale: 0.85 },
    ],
  },
  harbourFlag: {
    name: "Harbour flag",
    shelf: "harbour",
    price: 40,
    material: "wood",
    health: 60,
    note: "A tall pennant to steer home by.",
    scale: 1.6,
    pieces: [{ model: "coast/flag-high" }],
    foot: [0.5, 0.5],
    colliders: [{ cyl: 0.25 }],
  },

  /* ---------- defenses ---------- */
  rack: {
    name: "Weapon rack",
    shelf: "defenses",
    price: 40,
    material: "wood",
    health: 80,
    note: "Spears and swords to hand.",
    scale: 6,
    pieces: [{ model: "buildings/weaponrack" }],
  },
  target: {
    name: "Archery target",
    shelf: "defenses",
    price: 30,
    material: "wood",
    health: 60,
    note: "Straw on a stand, to practise on.",
    scale: 6,
    pieces: [{ model: "buildings/target" }],
  },
  cannon: {
    name: "Cannon",
    shelf: "defenses",
    price: 700,
    material: "stone",
    health: 800,
    note: "An iron gun on a timber carriage: sinks boats carrying raiders, and sweeps the beach.",
    scale: 1.3,
    pieces: [{ model: "coast/cannon" }],
  },
  ballista: {
    name: "Ballista",
    shelf: "defenses",
    price: 900,
    material: "wood",
    health: 600,
    note: "A giant crossbow on wheels: long bolts at raiders and their boats.",
    scale: 3,
    pieces: [{ model: "castle/siege-ballista" }],
  },
  catapult: {
    name: "Catapult",
    shelf: "defenses",
    price: 1300,
    material: "wood",
    health: 700,
    note: "Lobs stones over walls at raiders and the ships that bring them.",
    scale: 3,
    pieces: [{ model: "castle/siege-catapult", y: 0.149 * 3 }],
  },
  trebuchet: {
    name: "Trebuchet",
    shelf: "defenses",
    price: 1500,
    material: "wood",
    health: 800,
    note: "A counterweight engine that throws the heaviest stones furthest of all.",
    scale: 3,
    pieces: [{ model: "castle/siege-trebuchet" }],
  },
  archery: {
    name: "Archery range",
    shelf: "defenses",
    price: 1100,
    material: "wood",
    health: 1000,
    note: "A round tower and a timber hall, with targets: your towers' archers shoot faster.",
    scale: K,
    pieces: [{ model: "buildings/archeryrange" }],
  },
  barracks: {
    name: "Barracks",
    shelf: "defenses",
    price: 1400,
    material: "stone",
    health: 2200,
    note: "A fortified stone hall for your crew.",
    scale: K,
    pieces: [{ model: "buildings/barracks" }],
  },
  waterBarrel: {
    name: "Water barrel",
    shelf: "defenses",
    price: 120,
    material: "wood",
    health: 200,
    note: "Douses a fire that starts nearby, three times over, then slowly fills again.",
    scale: 0.85,
    pieces: [{ model: "coast/barrel" }, { model: "camp/bucket", x: 0.85, z: 0.35, scale: 2.6 }],
    douse: { radius: 9, charges: 3, refill: 60 },
  },
  catapultTower: {
    name: "Catapult tower",
    shelf: "defenses",
    price: 1600,
    material: "stone",
    health: 2600,
    note: "A stone tower with a catapult on its roof, lobbing stones from on high.",
    scale: K,
    pieces: [{ model: "buildings/tower-catapult" }],
  },

  /* ---------- nature ---------- */
  oak: {
    name: "Round tree",
    shelf: "nature",
    price: 40,
    material: "wood",
    health: 150,
    note: "A broad, coral-leaved tree.",
    scale: 1.6,
    pieces: [{ model: "forest/tree-1-b", palette: LEAF_PALETTE.coral }],
    foot: [0.7, 0.7],
    colliders: [{ cyl: 0.5 }],
  },
  blossom: {
    name: "Blossom tree",
    shelf: "nature",
    price: 50,
    material: "wood",
    health: 150,
    note: "Peach blossom all year round.",
    scale: 1.6,
    pieces: [{ model: "forest/tree-1-b", palette: LEAF_PALETTE.peach }],
    foot: [0.7, 0.7],
    colliders: [{ cyl: 0.5 }],
  },
  umbrella: {
    name: "Umbrella tree",
    shelf: "nature",
    price: 50,
    material: "wood",
    health: 150,
    note: "A wide, flat crown to stand under.",
    scale: 2,
    pieces: [{ model: "forest/tree-3-b", palette: LEAF_PALETTE.coral }],
    foot: [0.7, 0.7],
    colliders: [{ cyl: 0.55 }],
  },
  pine: {
    name: "Pine",
    shelf: "nature",
    price: 45,
    material: "wood",
    health: 150,
    note: "Tall and narrow: good for a windbreak.",
    scale: 1.5,
    pieces: [{ model: "forest/tree-4-b", palette: LEAF_PALETTE.teal }],
    foot: [0.6, 0.6],
    colliders: [{ cyl: 0.4 }],
  },
  palm: {
    name: "Palm",
    shelf: "nature",
    price: 45,
    material: "wood",
    health: 120,
    note: "For the beach.",
    scale: 1.5,
    pieces: [{ model: "coast/palm-straight" }],
    foot: [0.6, 0.6],
    colliders: [{ cyl: 0.35 }],
  },
  bush: {
    name: "Box bush",
    shelf: "nature",
    price: 15,
    material: "wood",
    health: 40,
    note: "Soft enough to push through.",
    scale: 1.4,
    pieces: [{ model: "forest/bush-2-c", palette: LEAF_PALETTE.coral }],
    colliders: "none",
  },
  hedge: {
    name: "Hedge",
    shelf: "nature",
    price: 25,
    material: "wood",
    health: 120,
    note: "Clipped box hedge, three metres a length. Snaps end to end.",
    scale: 3,
    pieces: [{ model: "town/hedge-large", rot: Q }],
    wall: true,
  },
  boulder: {
    name: "Boulder",
    shelf: "nature",
    price: 20,
    material: "stone",
    health: 1000,
    note: "A great lump of stone. Nothing gets through it.",
    scale: 1.6,
    pieces: [{ model: "forest/rock-2-c" }],
  },
  standingStone: {
    name: "Standing stone",
    shelf: "nature",
    price: 60,
    material: "stone",
    health: 1000,
    note: "A stacked stone column, like the ones on the high fells.",
    scale: 2.2,
    pieces: [{ model: "forest/rock-1-f" }],
  },
} satisfies Record<string, Def>;

export type CatalogueId = keyof typeof DEFS;
export const CATALOGUE_IDS = Object.keys(DEFS) as CatalogueId[];

export const isCatalogueId = (v: unknown): v is CatalogueId =>
  typeof v === "string" && Object.hasOwn(DEFS, v);

/* ---------- what's left ---------- */

const SIEGE_WRECKS: Partial<Record<ModelId, ModelId>> = {
  "castle/siege-ballista": "castle/siege-ballista-demolished",
  "castle/siege-catapult": "castle/siege-catapult-demolished",
  "castle/siege-trebuchet": "castle/siege-trebuchet-demolished",
  "castle/siege-ram": "castle/siege-ram-demolished",
  "castle/siege-tower": "castle/siege-tower-demolished",
};

/* A pile of planks or stones, of a scale to read at this size. */
function pile(material: Material, x: number, z: number, size: number, rot = 0): Piece {
  return material === "wood"
    ? { model: "camp/resource-planks", x, y: 0, z, rot: rot + Math.PI / 2, scale: size / 0.6 }
    : { model: "camp/resource-stone-large", x, y: 0, z, rot, scale: size / 0.38 };
}

/*
 * What's left of something knocked down or burnt out. Siege engines have
 * their own wrecks; a tree is left a bare trunk; anything low (a hedge, a
 * field, a jetty's deck) is flattened where it stood; a wall becomes a line
 * of rubble; a building a ruin; anything else a pile of what it was made of.
 */
function rubbleOf(d: Def, pieces: Piece[], hx: number, hz: number, top: number): Piece[] {
  if (pieces.every((p) => SIEGE_WRECKS[p.model]))
    return pieces.map((p) => ({ ...p, model: SIEGE_WRECKS[p.model] as ModelId }));
  const tree =
    d.shelf === "nature" && Array.isArray(d.colliders) && d.colliders.some((c) => "cyl" in c);
  if (tree) {
    const scale = (top * 0.55) / 3.48;
    return [{ model: "forest/tree-bare-2-a", x: 0, y: 0, z: 0, rot: 0, scale }];
  }
  if (d.shelf === "nature" || top < 2.4 || d.placing === "shore")
    return pieces.map((p) => ({ ...p, squash: d.placing === "shore" ? 0.6 : 0.2 }));
  if (d.wall) {
    const n = Math.max(1, Math.round((hx * 2) / 1.3));
    return Array.from({ length: n }, (_, i) =>
      pile(d.material, -hx + ((i + 0.5) * hx * 2) / n, 0, Math.min(1.5, hz * 2 + 0.6), i * 1.3),
    );
  }
  if (Math.min(hx, hz) >= 1.2) {
    const scale = Math.min((hx * 2) / 1.54, (hz * 2) / 1.3) * 0.95;
    return [{ model: "buildings/destroyed", x: 0, y: 0, z: 0, rot: 0, scale }];
  }
  return [pile(d.material, 0, 0, Math.min(1.8, Math.max(0.6, Math.min(hx, hz) * 2)))];
}

/* A piece's footprint in the item's space: the corners of its bounds, scaled and turned. */
function pieceBox(p: Piece) {
  const b = MODEL_BOUNDS[p.model];
  const c = Math.cos(p.rot);
  const s = Math.sin(p.rot);
  let x0 = Infinity;
  let x1 = -Infinity;
  let z0 = Infinity;
  let z1 = -Infinity;
  for (const bx of [b.min[0], b.max[0]])
    for (const bz of [b.min[2], b.max[2]]) {
      const lx = bx * p.scale;
      const lz = bz * p.scale;
      const x = p.x + lx * c + lz * s;
      const z = p.z - lx * s + lz * c;
      x0 = Math.min(x0, x);
      x1 = Math.max(x1, x);
      z0 = Math.min(z0, z);
      z1 = Math.max(z1, z);
    }
  return { x0, x1, z0, z1, top: p.y + b.max[1] * p.scale };
}

function build(id: CatalogueId, d: Def): CatalogueItem {
  const pieces: Piece[] = d.pieces.map((p) => ({
    model: p.model,
    x: p.x ?? 0,
    y: p.y ?? 0,
    z: p.z ?? 0,
    rot: p.rot ?? 0,
    scale: p.scale ?? d.scale,
    palette: p.palette,
  }));
  let x0 = Infinity;
  let x1 = -Infinity;
  let z0 = Infinity;
  let z1 = -Infinity;
  let top = 0;
  for (const p of pieces) {
    const b = pieceBox(p);
    x0 = Math.min(x0, b.x0);
    x1 = Math.max(x1, b.x1);
    z0 = Math.min(z0, b.z0);
    z1 = Math.max(z1, b.z1);
    top = Math.max(top, b.top);
  }
  let hx: number;
  let hz: number;
  if (d.foot) [hx, hz] = d.foot;
  else {
    /* Centred on its footprint, whatever the model's own origin (a fence drawn on a hex's edge). */
    const cx = (x0 + x1) / 2;
    const cz = (z0 + z1) / 2;
    for (const p of pieces) {
      p.x -= cx;
      p.z -= cz;
    }
    hx = (x1 - x0) / 2;
    hz = (z1 - z0) / 2;
  }
  const wall = !!d.wall;
  const defaults: ColliderDef[] = [
    wall
      ? { box: [hx, hz * 0.85], top, stand: true }
      : { box: [Math.max(0.15, hx * 0.88), Math.max(0.15, hz * 0.88)], top },
  ];
  const colliders = (d.colliders === "none" ? [] : (d.colliders ?? defaults)).map((c): Collider => {
    const [x, z] = c.at ?? [0, 0];
    const base = {
      x,
      z,
      bottom: c.bottom ?? -1,
      top: c.top ?? top,
      stand: c.stand ?? false,
    };
    return "cyl" in c
      ? { ...base, r: c.cyl }
      : { ...base, box: { hx: c.box[0], hz: c.box[1], rot: c.rot ?? 0 } };
  });
  return {
    id,
    name: d.name,
    shelf: d.shelf,
    price: d.price,
    material: d.material,
    health: d.health,
    note: d.note,
    pieces,
    rubble: rubbleOf(d, pieces, hx, hz, top),
    douse: d.douse ?? null,
    colliders,
    hx,
    hz,
    top,
    placing: d.placing ?? "land",
    wall,
    post: !!d.post,
  };
}

export const CATALOGUE = Object.fromEntries(
  CATALOGUE_IDS.map((id) => [id, build(id, DEFS[id] as Def)]),
) as Record<CatalogueId, CatalogueItem>;

/* Selling something back gets you this share of its price. */
export const RESALE = 0.5;
export const resale = (id: CatalogueId) => Math.floor(CATALOGUE[id].price * RESALE);

/* ---------- things placed on a plot ---------- */

/*
 * One thing bought and set down. `hp` is its health as of `hitAt` (when it
 * was last hurt, in the room's clock: wall-clock seconds online), from when
 * it heals by itself (see siege.ts); at 0 it's rubble. `burnt`: it was fire
 * that brought it down, so what's left is charred.
 */
export type PlacedItem = {
  id: number;
  kind: CatalogueId;
  x: number;
  y: number;
  z: number;
  rot: number;
  hp: number;
  hitAt?: number;
  burnt?: boolean;
};

/* What a thing is going through, as bits on the wire. `doused` is news: it was just put out. */
export const ITEM_STATE = { burning: 1, burnt: 2, doused: 4 } as const;

/* On the wire: [id, catalogue index, x, y, z, rot, health now, ITEM_STATE bits]. */
export type ItemSnap = [number, number, number, number, number, number, number, number];

export function packItem(p: PlacedItem, state = 0): ItemSnap {
  const bits = state | (p.burnt ? ITEM_STATE.burnt : 0);
  return [p.id, CATALOGUE_IDS.indexOf(p.kind), p.x, p.y, p.z, p.rot, p.hp, bits];
}

export function unpackItem(s: ItemSnap): PlacedItem | null {
  const kind = CATALOGUE_IDS[s[1]];
  if (!kind) return null;
  const p: PlacedItem = { id: s[0], kind, x: s[2], y: s[3], z: s[4], rot: s[5], hp: s[6] };
  if ((s[7] ?? 0) & ITEM_STATE.burnt) p.burnt = true;
  return p;
}

/* Item space to the world, as three.js turns things about +y. */
export function itemToWorld(x: number, z: number, rot: number, lx: number, lz: number) {
  const c = Math.cos(rot);
  const s = Math.sin(rot);
  return { x: x + lx * c + lz * s, z: z - lx * s + lz * c };
}

/* The palette a piece draws with, for an owner of this team. */
export function piecePalette(p: Piece, team: Team) {
  if (p.palette) return p.palette;
  const pack = p.model.split("/")[0];
  const teamed = pack === "buildings" || pack === "castle";
  return teamed && team !== "blue"
    ? `/models/${pack}/palette-${team}.png`
    : `/models/${pack}/palette.png`;
}
