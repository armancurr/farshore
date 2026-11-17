import type { HullSpec } from "./boat";
import type { CarSpec } from "./car";
import { MODEL_BOUNDS, type ModelId } from "./models.gen";
import type { MountSpec } from "./mount";

/*
 * Things to ride, chosen from the marketplace: the asset packs' boats, ships
 * and cars, and the horses and donkeys from the islands. Spawning one puts it
 * in the water or on clear ground near you; you get one at a time, and a new
 * one replaces the last. Everything is free for now; `price` is what it will
 * cost once the market takes coins.
 *
 * A vehicle's class decides how it moves and how you drive it:
 *   row    oars: slow, W and S pull, A and D turn
 *   sail   the wind drives it (see wind.ts): W and S set or take in sail
 *   motor  an engine: a throttle, and turns that bank
 *   car    four wheels over the hills: they climb what a person could, not walls
 *   mount  a horse or a donkey: walk on, gallop with Shift, jump with Space
 *
 * Every vehicle lives in its own frame: forward is -z (as for a body), the
 * origin is on the waterline (boats) or the ground (land), in the middle of
 * the footprint. The models face +z in their own units, so they're turned
 * round and scaled to real sizes here, once, for the room and the client alike.
 */

export type VehicleClass = "row" | "sail" | "motor" | "car" | "mount";
export type VehicleSection = "Boats" | "Workboats" | "Ships" | "Land" | "Mounts";
/* Workboats and mounts are put away for now (their kinds are commented out in VEHICLES). */
export const VEHICLE_SECTIONS: readonly VehicleSection[] = [
  "Boats",
  // "Workboats",
  "Ships",
  "Land",
  // "Mounts",
];

/*
 * Somewhere to sit, in the vehicle's frame: `y` is the seat itself, where the
 * rider's hips go. The first seat steers. On a ship's deck there's a cask to
 * sit on, `cask` metres tall.
 */
export type Seat = { x: number; y: number; z: number; cask?: number };

export type VehicleDef = {
  name: string;
  section: VehicleSection;
  class: VehicleClass;
  price: number;
  /* What it is, in a line, for the marketplace. */
  blurb: string;
  /* A pack model, or an animal's file for a mount. */
  model: string;
  /* Model units to metres, and where the model's origin sits in the vehicle's frame. */
  scale: number;
  offset: { y: number; z: number };
  seats: readonly Seat[];
  /* The footprint and height, in metres. */
  length: number;
  beam: number;
  height: number;
  hull?: HullSpec;
  car?: CarSpec;
  mount?: MountSpec;
};

/*
 * How far below the seat the rider's origin goes: the characters' seated
 * pose (Driving) carries the hips about this high over it, so this puts the
 * seat of their trousers on the seat.
 */
export const RIDER_HIP = 0.17;
/* A seated rider's eyes, above the seat. */
export const SEATED_EYE = 0.78;
/* How close you need to be to the side of a vehicle to climb aboard. */
export const BOARD_REACH = 2.6;

/* ---------- building the catalogue ---------- */

/* A seat in the model's own units, and how far over that spot it is, in metres (on a cask). */
type Native = readonly [number, number, number] | readonly [number, number, number, number];

function frame(model: ModelId, length: number, sink: number) {
  const b = MODEL_BOUNDS[model];
  const scale = length / (b.max[2] - b.min[2]);
  const cz = (b.max[2] + b.min[2]) / 2;
  /* A point in the model's own units, bow toward +z, into the vehicle's frame. */
  const at = (n: Native): Seat => {
    const cask = n[3] ?? 0;
    return {
      x: -n[0] * scale,
      y: (n[1] - sink) * scale + cask,
      z: -(n[2] - cz) * scale,
      ...(cask > 0 ? { cask } : {}),
    };
  };
  return {
    b,
    scale,
    at,
    offset: { y: -sink * scale, z: cz * scale },
    height: (b.max[1] - sink) * scale,
    along: (z: number) => -(z - cz) * scale,
  };
}

type WaterOpts = {
  name: string;
  section: VehicleSection;
  class: "row" | "sail" | "motor";
  price: number;
  blurb: string;
  model: ModelId;
  /* Overall length in metres; the model is scaled to it. */
  length: number;
  /* How much of the hull, in model units, is under the water. */
  sink: number;
  /* Half the hull's width in model units, when the bounds are wider (oars, say). */
  half?: number;
  /* Seats in model units: the helm first. */
  seats: readonly Native[];
  draft: number;
  speed: number;
  turn: number;
  accel?: number;
  reverse?: number;
};

function water(o: WaterOpts): VehicleDef {
  const f = frame(o.model, o.length, o.sink);
  const beam = 2 * (o.half ?? f.b.max[0]) * f.scale;
  const hull: HullSpec = {
    length: o.length,
    beam,
    draft: o.draft,
    speed: o.speed,
    reverse: o.reverse ?? Math.min(4, o.speed * 0.25),
    accel: o.accel ?? o.speed * 0.3,
    drag: o.class === "row" ? 0.45 : 0.3,
    turn: o.turn,
    mode: o.class === "row" ? "row" : o.class === "sail" ? "sail" : "motor",
  };
  return {
    name: o.name,
    section: o.section,
    class: o.class,
    price: o.price,
    blurb: o.blurb,
    model: o.model,
    scale: f.scale,
    offset: f.offset,
    seats: o.seats.map(f.at),
    length: o.length,
    beam,
    height: f.height,
    hull,
  };
}

/* The car kit is one consistent scale: a sedan is about four metres long. */
const CAR_SCALE = 1.6;

type CarOpts = {
  name: string;
  price: number;
  blurb: string;
  model: ModelId;
  /* Model units: the front and back axles along z, half the track, the tyres' radius. */
  wheels: { front: number; back: number; half: number; tire: number };
  seats: readonly Native[];
  speed: number;
  accel: number;
  /* Most steering lock, in radians, at walking pace. */
  steer?: number;
  /* Ground clearance under the middle, in metres. */
  clearance?: number;
};

function car(o: CarOpts): VehicleDef {
  const b = MODEL_BOUNDS[o.model];
  const length = (b.max[2] - b.min[2]) * CAR_SCALE;
  const f = frame(o.model, length, 0);
  const s = f.scale;
  const front = f.along(o.wheels.front);
  const back = f.along(o.wheels.back);
  return {
    name: o.name,
    section: "Land",
    class: "car",
    price: o.price,
    blurb: o.blurb,
    model: o.model,
    scale: s,
    offset: f.offset,
    seats: o.seats.map((n) => f.at(n)),
    length,
    beam: (b.max[0] - b.min[0]) * s,
    height: f.height,
    car: {
      speed: o.speed,
      reverse: 5,
      accel: o.accel,
      brake: 14,
      front,
      back,
      track: o.wheels.half * 2 * s,
      tire: o.wheels.tire * s,
      halfLength: length / 2,
      halfWidth: ((b.max[0] - b.min[0]) * s) / 2,
      clearance: o.clearance ?? 0.32,
      height: f.height,
      steer: o.steer ?? 0.55,
    },
  };
}

type MountOpts = {
  name: string;
  price: number;
  blurb: string;
  model: string;
  /* How tall it stands, to the ears, in metres. */
  height: number;
  /* The saddle, in metres over the ground and behind the middle. */
  seat: { y: number; z: number };
  walk: number;
  trot: number;
  gallop: number;
  jump: number;
};

function mount(o: MountOpts): VehicleDef {
  return {
    name: o.name,
    section: "Mounts",
    class: "mount",
    price: o.price,
    blurb: o.blurb,
    model: o.model,
    scale: o.height,
    offset: { y: 0, z: 0 },
    seats: [{ x: 0, y: o.seat.y, z: o.seat.z }],
    length: o.height * 1.15,
    beam: 0.7,
    height: o.height,
    mount: {
      walk: o.walk,
      trot: o.trot,
      gallop: o.gallop,
      back: 1.4,
      turn: 2.1,
      jump: o.jump,
      length: o.height * 1.05,
      radius: 0.42,
      height: o.height * 0.8,
    },
  };
}

/* ---------- the catalogue ---------- */

const ROW = (o: Omit<WaterOpts, "class" | "section" | "draft" | "turn" | "half">) =>
  water({ ...o, class: "row", section: "Boats", draft: 0.35, turn: 1.25, half: 0.72 });

/* Speedboats share a hull shape and scale; they differ in looks, pace and price. */
const SPEED = (
  o: Omit<WaterOpts, "class" | "section" | "draft" | "turn" | "sink" | "length"> & {
    length?: number;
  },
) =>
  water({
    length: (MODEL_BOUNDS[o.model].max[2] - MODEL_BOUNDS[o.model].min[2]) * 1.85,
    ...o,
    class: "motor",
    section: "Boats",
    draft: 0.55,
    turn: 1.05,
    sink: 0.32,
  });

const HOUSE = (o: Omit<WaterOpts, "class" | "section" | "draft" | "turn" | "speed" | "sink">) =>
  water({
    ...o,
    class: "motor",
    section: "Workboats",
    draft: 0.8,
    turn: 0.45,
    speed: 11,
    sink: 0.3,
  });

const SHIP = (o: Omit<WaterOpts, "class" | "section" | "sink">) =>
  water({ ...o, class: "sail", section: "Ships", sink: 1.05 });

/*
 * Small, medium and large hulls of the pirate kit. The helmsman perches on a
 * tall cask behind the wheel, high enough to see over it; the crew sit on
 * casks along the main deck, clear of the masts.
 */
const HELM = 0.85;
const DECK = 0.5;
const HULL_SMALL: readonly Native[] = [
  [0, 3.5, -3.5, HELM],
  [1.25, 2.1, -1.75, DECK],
  [-1.25, 2.1, -1.75, DECK],
];
const HULL_MEDIUM: readonly Native[] = [
  /* Behind the wheel, well aft of the mizzen. */
  [0, 3.5, -4.8, HELM],
  [1.3, 2.1, -0.1, DECK],
  [-1.3, 2.1, -0.1, DECK],
  [1.3, 2.1, 2.5, DECK],
  [-1.3, 2.1, 2.5, DECK],
];
const HULL_LARGE: readonly Native[] = [
  [0, 3.5, -5.55, HELM],
  [1.3, 2.3, -2.6, DECK],
  [-1.3, 2.3, -2.6, DECK],
  [1.3, 2.1, 1.5, DECK],
  [-1.3, 2.1, 1.5, DECK],
  [1.2, 2.8, 2.9, DECK],
  [-1.2, 2.8, 2.9, DECK],
];

/* Speedboats: the helm behind the windscreen, a seat beside it. */
const BESIDE = (z: number, y: number): readonly Native[] => [
  [0.32, y, z],
  [-0.32, y, z],
];

/*
 * The catalogue. A trimmed first roster is on offer: nine boats, six ships,
 * six cars. The rest are commented out, not deleted, so any of them can come
 * back by uncommenting its entry.
 */
export const VEHICLES = {
  /* ----- boats: oars, sails and outboards ----- */
  rowboat: ROW({
    name: "Rowboat",
    price: 180,
    blurb: "A clinker-built rowboat: slow, steady and hard to sink.",
    model: "boats/boat-row-small",
    length: 3.6,
    sink: 0.16,
    seats: [[0, 0.4, -0.42]],
    speed: 13,
  }),
  skiff: ROW({
    name: "Skiff",
    price: 240,
    blurb: "A longer rowboat with room for a passenger in the bow.",
    model: "boats/boat-row-large",
    length: 4.3,
    sink: 0.16,
    seats: [
      [0, 0.4, -0.18],
      [0, 0.4, 0.8],
    ],
    speed: 14,
  }),
  daysailer: water({
    name: "Daysailer",
    section: "Boats",
    class: "sail",
    price: 420,
    blurb: "A little open sailboat. Quick on a reach, useless head to wind.",
    model: "boats/boat-sail-a",
    length: 7,
    sink: 0.32,
    /* On the cockpit coaming, to see past the cabin. */
    seats: [
      [0.55, 1.5, -1.25],
      [-0.55, 1.5, -1.25],
    ],
    draft: 0.8,
    speed: 22,
    turn: 0.85,
  }),
  sloop: water({
    name: "Sloop",
    section: "Boats",
    class: "sail",
    price: 480,
    blurb: "A sloop with a long bowsprit: points a little higher than the daysailer.",
    model: "boats/boat-sail-b",
    length: 7.6,
    sink: 0.32,
    seats: [
      [0.55, 1.5, -1.4],
      [-0.55, 1.5, -1.4],
    ],
    draft: 0.9,
    speed: 24,
    turn: 0.8,
  }),
  airboat: water({
    name: "Airboat",
    section: "Boats",
    class: "motor",
    price: 520,
    blurb: "A flat hull and a caged propeller. Loud, flat-out quick, and it skids.",
    model: "boats/boat-fan",
    length: 5,
    sink: 0.2,
    seats: [
      [0, 0.95, -0.66],
      [0, 0.45, 0.3],
    ],
    draft: 0.3,
    speed: 48,
    turn: 1.3,
  }),
  fishingboat: water({
    name: "Fishing boat",
    section: "Boats",
    class: "motor",
    price: 560,
    blurb: "A little wheelhouse boat for long days out past the islands.",
    model: "boats/boat-fishing-small",
    length: 7.5,
    sink: 0.38,
    seats: [
      [0.2, 1.05, 0.38],
      [-0.4, 1.05, -1.2],
    ],
    draft: 0.9,
    speed: 22,
    turn: 0.8,
  }),
  //   wakeboat: SPEED({
  //     name: "Wakeboard boat",
  //     price: 900,
  //     blurb: "A deep hull and a tow tower, built to throw a big wake.",
  //     model: "boats/boat-speed-a",
  //     seats: BESIDE(-0.75, 1.15),
  //     speed: 48,
  //   }),
  //   bowrider: SPEED({
  //     name: "Bowrider",
  //     price: 820,
  //     blurb: "Open seats right up into the bow, and a windscreen for the helm.",
  //     model: "boats/boat-speed-b",
  //     seats: BESIDE(-0.7, 1.12),
  //     speed: 50,
  //   }),
  runabout: SPEED({
    name: "Runabout",
    price: 760,
    blurb: "A small, lively speedboat for hopping between the islands.",
    model: "boats/boat-speed-c",
    seats: BESIDE(-0.65, 1.12),
    speed: 52,
  }),
  //   tender: SPEED({
  //     name: "Harbour tender",
  //     price: 600,
  //     blurb: "A broad inflatable with fat fenders. Slow to plane, hard to tip.",
  //     model: "boats/boat-speed-d",
  //     seats: BESIDE(-1.05, 0.95),
  //     speed: 36,
  //   }),
  //   surveylaunch: SPEED({
  //     name: "Survey launch",
  //     price: 700,
  //     blurb: "A stubby launch with a console and a mast of aerials.",
  //     model: "boats/boat-speed-e",
  //     seats: BESIDE(-0.55, 0.95),
  //     speed: 40,
  //   }),
  //   centreconsole: SPEED({
  //     name: "Centre console",
  //     price: 680,
  //     blurb: "A wide, open skiff with the helm in the middle.",
  //     model: "boats/boat-speed-f",
  //     seats: BESIDE(-0.45, 0.95),
  //     speed: 42,
  //   }),
  jetboat: SPEED({
    name: "Jet boat",
    price: 1100,
    blurb: "A low, sleek hull for flat-out runs. Nothing afloat is faster.",
    model: "boats/boat-speed-g",
    seats: BESIDE(-0.95, 1.05),
    speed: 62,
  }),
  //   skiboat: SPEED({
  //     name: "Ski boat",
  //     price: 860,
  //     blurb: "A sharp bow, a ski arch and a hull that likes to be driven hard.",
  //     model: "boats/boat-speed-h",
  //     seats: BESIDE(-0.9, 1.05),
  //     speed: 54,
  //   }),
  //   pilotlaunch: SPEED({
  //     name: "Pilot launch",
  //     price: 940,
  //     blurb: "A long, sure-footed launch with a cabin and aerials.",
  //     model: "boats/boat-speed-i",
  //     seats: BESIDE(-0.9, 1.05),
  //     speed: 48,
  //   }),
  daycruiser: SPEED({
    name: "Day cruiser",
    price: 1200,
    blurb: "The longest of the speedboats, with a cuddy cabin in the bow.",
    model: "boats/boat-speed-j",
    seats: BESIDE(-1.25, 1.05),
    speed: 50,
  }),

  /* ----- workboats: tugs, towboats and houseboats ----- */
  //   harbourtug: water({
  //     name: "Harbour tug",
  //     section: "Workboats",
  //     class: "motor",
  //     price: 900,
  //     blurb: "A stout tug with a tall wheelhouse and two funnels.",
  //     model: "boats/boat-tug-a",
  //     length: 7.5,
  //     sink: 0.45,
  //     seats: [
  //       [0, 0.95, 0.55],
  //       [0, 0.95, 1.25],
  //     ],
  //     draft: 1.4,
  //     speed: 18,
  //     turn: 0.7,
  //   }),
  //   pushtug: water({
  //     name: "Pusher tug",
  //     section: "Workboats",
  //     class: "motor",
  //     price: 820,
  //     blurb: "A short, square tug: all engine and wheelhouse.",
  //     model: "boats/boat-tug-b",
  //     length: 6.4,
  //     sink: 0.45,
  //     seats: [
  //       [0, 0.95, 0.35],
  //       [0, 0.95, 1.1],
  //     ],
  //     draft: 1.3,
  //     speed: 17,
  //     turn: 0.8,
  //   }),
  //   workboat: water({
  //     name: "Workboat",
  //     section: "Workboats",
  //     class: "motor",
  //     price: 740,
  //     blurb: "A small open tug for odd jobs round the harbour.",
  //     model: "boats/boat-tug-c",
  //     length: 6.4,
  //     sink: 0.45,
  //     seats: [
  //       [0, 0.95, -0.2],
  //       [0, 0.95, 0.85],
  //     ],
  //     draft: 1.2,
  //     speed: 19,
  //     turn: 0.85,
  //   }),
  //   towboat: water({
  //     name: "Towboat",
  //     section: "Workboats",
  //     class: "motor",
  //     price: 1400,
  //     blurb: "A big river towboat with a raised pilothouse. Slow, and unstoppable.",
  //     model: "boats/boat-tow-a",
  //     length: 12,
  //     sink: 0.5,
  //     /* Up on the pilothouse roof, where the view is. */
  //     seats: [
  //       [0, 3.33, 0.75],
  //       [0.7, 1.16, 2.1, DECK],
  //     ],
  //     draft: 1.6,
  //     speed: 16,
  //     turn: 0.42,
  //   }),
  //   pushboat: water({
  //     name: "Push boat",
  //     section: "Workboats",
  //     class: "motor",
  //     price: 1300,
  //     blurb: "The towboat's plainer sister, with an open upper deck.",
  //     model: "boats/boat-tow-b",
  //     length: 12,
  //     sink: 0.5,
  //     seats: [
  //       [0, 2.61, 0.8, DECK],
  //       [0.7, 1.16, 2.1, DECK],
  //     ],
  //     draft: 1.6,
  //     speed: 16,
  //     turn: 0.42,
  //   }),
  //   houseboat: HOUSE({
  //     name: "Houseboat",
  //     price: 800,
  //     blurb: "A cabin on a pontoon. Unhurried, but you could live on it.",
  //     model: "boats/boat-house-a",
  //     length: 10,
  //     seats: [
  //       [0, 0.7, 1.85, DECK],
  //       [0.5, 0.7, -1.85, DECK],
  //     ],
  //   }),
  //   canalboat: HOUSE({
  //     name: "Canal boat",
  //     price: 860,
  //     blurb: "A long, narrow houseboat with a sun deck at either end.",
  //     model: "boats/boat-house-b",
  //     length: 11.5,
  //     seats: [
  //       [0, 0.73, 2.1, DECK],
  //       [0.5, 0.73, -2.1, DECK],
  //     ],
  //   }),
  //   cottageboat: HOUSE({
  //     name: "Floating cottage",
  //     price: 1000,
  //     blurb: "Two decks of cottage, afloat. The upper deck has the view.",
  //     model: "boats/boat-house-c",
  //     length: 11,
  //     seats: [
  //       [0, 0.73, 1.95, DECK],
  //       [0.5, 0.73, -1.95, DECK],
  //     ],
  //   }),
  //   sundeckboat: HOUSE({
  //     name: "Sundeck houseboat",
  //     price: 1050,
  //     blurb: "A houseboat with a roof terrace for watching the islands go by.",
  //     model: "boats/boat-house-d",
  //     length: 10,
  //     seats: [
  //       [0, 0.7, 1.85, DECK],
  //       [0.5, 0.7, -1.85, DECK],
  //     ],
  //   }),

  /* ----- ships: the wind drives them, and they carry a crew ----- */
  pirate_sloop: SHIP({
    name: "Pirate sloop",
    price: 2400,
    blurb: "A single-masted raider under a black sail. Seats a helmsman and two.",
    model: "ships/ship-pirate-small",
    length: 11,
    seats: HULL_SMALL,
    draft: 1.6,
    speed: 62,
    turn: 0.42,
  }),
  pirate_brig: SHIP({
    name: "Pirate brig",
    price: 4200,
    blurb: "Two masts of black canvas, a helmsman and a crew of four.",
    model: "ships/ship-pirate-medium",
    length: 17,
    seats: HULL_MEDIUM,
    draft: 2.2,
    speed: 62,
    turn: 0.32,
  }),
  pirate_galleon: SHIP({
    name: "Pirate galleon",
    price: 7600,
    blurb: "A great black-sailed galleon. Quick, but slow to turn; a helmsman and a crew of six.",
    model: "ships/ship-pirate-large",
    length: 27,
    seats: HULL_LARGE,
    draft: 3,
    speed: 62,
    turn: 0.22,
  }),
  trading_sloop: SHIP({
    name: "Trading sloop",
    price: 2000,
    blurb: "A plain working sloop under white sail. Seats a helmsman and two.",
    model: "ships/ship-small",
    length: 11,
    seats: HULL_SMALL,
    draft: 1.6,
    speed: 62,
    turn: 0.42,
  }),
  brigantine: SHIP({
    name: "Brigantine",
    price: 3600,
    blurb: "A handy two-master under white sail, a helmsman and a crew of four.",
    model: "ships/ship-medium",
    length: 17,
    seats: HULL_MEDIUM,
    draft: 2.2,
    speed: 62,
    turn: 0.32,
  }),
  galleon: SHIP({
    name: "Galleon",
    price: 6800,
    blurb: "A tall merchant galleon. Quick, but slow to turn; a helmsman and a crew of six.",
    model: "ships/ship-large",
    length: 27,
    seats: HULL_LARGE,
    draft: 3,
    speed: 62,
    turn: 0.22,
  }),
  //   ghost_ship: SHIP({
  //     name: "Ghost ship",
  //     price: 6600,
  //     blurb: "Tattered sails that somehow still draw. Faster than it has any right to be.",
  //     model: "ships/ship-ghost",
  //     length: 17,
  //     seats: HULL_MEDIUM,
  //     draft: 2.2,
  //     speed: 62,
  //     turn: 0.36,
  //   }),

  /* ----- land: the car kit's working machines and a few for fun ----- */
  //   tractor: car({
  //     name: "Tractor",
  //     price: 500,
  //     blurb: "Big back wheels and a low gear: it'll go anywhere, slowly.",
  //     model: "cars/tractor",
  //     wheels: { front: 0.73, back: -0.58, half: 0.44, tire: 0.42 },
  //     seats: [[0, 0.95, -0.35]],
  //     speed: 11,
  //     accel: 4,
  //     clearance: 0.5,
  //   }),
  //   loader: car({
  //     name: "Front loader",
  //     price: 640,
  //     blurb: "A tractor with a bucket on the front. Slow and very sure-footed.",
  //     model: "cars/tractor-shovel",
  //     wheels: { front: 0.41, back: -0.69, half: 0.6, tire: 0.36 },
  //     seats: [[0, 0.9, -0.45]],
  //     speed: 10,
  //     accel: 3.5,
  //     clearance: 0.45,
  //   }),
  //   pickup: car({
  //     name: "Pickup",
  //     price: 900,
  //     blurb: "A pickup with an open bed. Happy on a track or off it.",
  //     model: "cars/truck",
  //     wheels: { front: 0.86, back: -0.76, half: 0.43, tire: 0.3 },
  //     seats: [
  //       [0.22, 0.58, 0.05],
  //       [-0.22, 0.58, 0.05],
  //     ],
  //     speed: 27,
  //     accel: 7,
  //     clearance: 0.38,
  //   }),
  //   flatbed: car({
  //     name: "Flatbed",
  //     price: 880,
  //     blurb: "A short cab and a flat deck behind it.",
  //     model: "cars/truck-flat",
  //     wheels: { front: 0.78, back: -0.64, half: 0.45, tire: 0.3 },
  //     seats: [
  //       [0.22, 0.58, 0.35],
  //       [-0.22, 0.58, 0.35],
  //     ],
  //     speed: 25,
  //     accel: 6.5,
  //     clearance: 0.38,
  //   }),
  fourbyfour: car({
    name: "Four-by-four",
    price: 1100,
    blurb: "A boxy off-roader with a high ride: the best thing for the hills.",
    model: "cars/suv",
    wheels: { front: 0.76, back: -0.56, half: 0.43, tire: 0.3 },
    seats: [
      [0.22, 0.58, 0.05],
      [-0.22, 0.58, 0.05],
    ],
    speed: 28,
    accel: 7.5,
    clearance: 0.42,
  }),
  touring: car({
    name: "Touring SUV",
    price: 1500,
    blurb: "A long, plush SUV. Quiet, quick and comfortable.",
    model: "cars/suv-luxury",
    wheels: { front: 0.81, back: -0.71, half: 0.43, tire: 0.3 },
    seats: [
      [0.22, 0.58, 0.1],
      [-0.22, 0.58, 0.1],
    ],
    speed: 31,
    accel: 8,
    clearance: 0.38,
  }),
  campervan: car({
    name: "Camper van",
    price: 1000,
    blurb: "A tall van for long trips round the island roads.",
    model: "cars/van",
    wheels: { front: 0.76, back: -0.76, half: 0.43, tire: 0.3 },
    seats: [
      [0.22, 0.62, 0.32],
      [-0.22, 0.62, 0.32],
    ],
    speed: 24,
    accel: 6,
    clearance: 0.36,
  }),
  sedan: car({
    name: "Sedan",
    price: 950,
    blurb: "An everyday saloon: comfortable, sensible, not built for the hills.",
    model: "cars/sedan",
    wheels: { front: 0.66, back: -0.66, half: 0.43, tire: 0.3 },
    seats: [
      [0.22, 0.55, -0.05],
      [-0.22, 0.55, -0.05],
    ],
    speed: 30,
    accel: 8,
    clearance: 0.3,
  }),
  coupe: car({
    name: "Coupé",
    price: 1700,
    blurb: "A low two-door with a big engine.",
    model: "cars/sedan-sports",
    wheels: { front: 0.66, back: -0.66, half: 0.43, tire: 0.3 },
    seats: [
      [0.22, 0.48, -0.1],
      [-0.22, 0.48, -0.1],
    ],
    speed: 36,
    accel: 10,
    clearance: 0.26,
  }),
  hothatch: car({
    name: "Hot hatch",
    price: 1300,
    blurb: "A short, stiff hatchback that loves a corner.",
    model: "cars/hatchback-sports",
    wheels: { front: 0.81, back: -0.81, half: 0.43, tire: 0.3 },
    seats: [
      [0.22, 0.48, 0.05],
      [-0.22, 0.48, 0.05],
    ],
    speed: 33,
    accel: 10,
    steer: 0.6,
    clearance: 0.28,
  }),
  //   racer: car({
  //     name: "Racer",
  //     price: 3000,
  //     blurb: "An open-wheel racer. Ferocious on the flat, hopeless off it.",
  //     model: "cars/race",
  //     wheels: { front: 0.64, back: -0.88, half: 0.5, tire: 0.3 },
  //     seats: [[0, 0.28, -0.25]],
  //     speed: 44,
  //     accel: 13,
  //     steer: 0.5,
  //     clearance: 0.18,
  //   }),
  //   prototype: car({
  //     name: "Prototype",
  //     price: 4000,
  //     blurb: "A wedge from the future. The quickest thing on wheels.",
  //     model: "cars/race-future",
  //     wheels: { front: 0.59, back: -0.93, half: 0.45, tire: 0.3 },
  //     seats: [[0, 0.32, -0.2]],
  //     speed: 48,
  //     accel: 14,
  //     steer: 0.5,
  //     clearance: 0.2,
  //   }),
  //   boxtruck: car({
  //     name: "Box truck",
  //     price: 1200,
  //     blurb: "A tall box van: slow up the hills, roomy inside.",
  //     model: "cars/delivery",
  //     wheels: { front: 1.01, back: -0.61, half: 0.45, tire: 0.3 },
  //     seats: [
  //       [0.22, 0.65, 0.78],
  //       [-0.22, 0.65, 0.78],
  //     ],
  //     speed: 22,
  //     accel: 5,
  //     clearance: 0.36,
  //   }),
  //   staketruck: car({
  //     name: "Stake truck",
  //     price: 1150,
  //     blurb: "A cab-over truck with a flat bed and stake sides.",
  //     model: "cars/delivery-flat",
  //     wheels: { front: 1.01, back: -0.61, half: 0.49, tire: 0.3 },
  //     seats: [
  //       [0.22, 0.65, 0.78],
  //       [-0.22, 0.65, 0.78],
  //     ],
  //     speed: 23,
  //     accel: 5.5,
  //     clearance: 0.36,
  //   }),

  /* ----- mounts ----- */
  //   horse: mount({
  //     name: "Bay horse",
  //     price: 340,
  //     blurb: "A sure-footed bay. Walks, trots, gallops and jumps.",
  //     model: "/models/animals/horse.glb",
  //     height: 2,
  //     seat: { y: 1.47, z: 0.06 },
  //     walk: 2,
  //     trot: 5.5,
  //     gallop: 14,
  //     jump: 7,
  //   }),
  //   greyhorse: mount({
  //     name: "Grey horse",
  //     price: 380,
  //     blurb: "A pale grey with a long stride: a touch quicker than the bay.",
  //     model: "/models/animals/horse_white.glb",
  //     height: 2,
  //     seat: { y: 1.47, z: 0.06 },
  //     walk: 2.1,
  //     trot: 5.8,
  //     gallop: 15,
  //     jump: 7,
  //   }),
  //   donkey: mount({
  //     name: "Donkey",
  //     price: 160,
  //     blurb: "Short, stubborn and steady. Never in a hurry.",
  //     model: "/models/animals/donkey.glb",
  //     height: 1.5,
  //     seat: { y: 1.09, z: 0.05 },
  //     walk: 1.6,
  //     trot: 4,
  //     gallop: 8.5,
  //     jump: 5.5,
  //   }),
} satisfies Record<string, VehicleDef>;

export type VehicleKind = keyof typeof VEHICLES;

/* In marketplace order: by section, as listed above. */
export const VEHICLE_KINDS = Object.keys(VEHICLES) as VehicleKind[];

export const isVehicleKind = (v: unknown): v is VehicleKind =>
  typeof v === "string" && Object.hasOwn(VEHICLES, v);

export const vehicleDef = (kind: VehicleKind): VehicleDef => VEHICLES[kind];

/* A kind's place in VEHICLE_KINDS, for snapshots, and back. */
const INDEX = new Map(VEHICLE_KINDS.map((k, i) => [k, i]));
export const vehicleIndex = (kind: VehicleKind) => INDEX.get(kind) ?? 0;
export const vehicleFromIndex = (i: number): VehicleKind | null => VEHICLE_KINDS[i] ?? null;

/* Does it float? */
export const afloat = (kind: VehicleKind) => {
  const c = VEHICLES[kind].class;
  return c === "row" || c === "sail" || c === "motor";
};

/* How to drive it, a control at a time, for the marketplace and the HUD. */
export function controlsOf(kind: VehicleKind) {
  switch (VEHICLES[kind].class) {
    case "row":
      return "W/S row · A/D turn";
    case "sail":
      return gunsOf(kind)
        ? "W/S set and take in sail · A/D steer · click fires a broadside the way you look"
        : "W/S set and take in sail · A/D steer";
    case "motor":
      return "W throttle · S astern · A/D steer";
    case "car":
      return "W/S drive and brake · A/D steer · Space handbrake";
    case "mount":
      return "W walk on · Shift gallop · A/D turn · Space jump";
  }
}

/*
 * How much battering a vehicle takes before it's wrecked (a boat goes down,
 * a car is a write-off): ships are built to take a broadside or two, a
 * rowboat a cannonball.
 */
export function hullOf(kind: VehicleKind) {
  const d = VEHICLES[kind];
  if (d.section === "Ships") return Math.round(60 * d.length);
  if (afloat(kind)) return Math.round(35 * d.length);
  return 300;
}

/* Cannons down each side of a ship: two on a sloop, three on a brig, four on a galleon. */
export function gunsOf(kind: VehicleKind) {
  const d = VEHICLES[kind];
  if (d.section !== "Ships") return 0;
  return d.length < 14 ? 2 : d.length < 20 ? 3 : 4;
}

/* Seconds between broadsides from one side of a ship. */
export const BROADSIDE_RELOAD = 6;
/* How fast a ship's cannonball leaves the gun. */
export const BROADSIDE_SPEED = 62;

/* Older saves: the hand-built rowboat became the rowboat; the desert bike is gone. */
export function migrateKind(v: unknown): VehicleKind | null {
  if (isVehicleKind(v)) return v;
  return null;
}
