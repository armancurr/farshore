import { BASE_CELL, BASE_TILE, ISLAND_RADIUS, MAX_HEIGHT, SEA_FLOOR } from "./constants";
import { createNoise2D, fbm, mulberry32, type Rng, range, smoothstep } from "./math";

/*
 * The grand map is authored: the Harbor in the middle and the hunting islands
 * round it, all listed in WORLD below. Each is a square tile of land and sea.
 * A shape is drawn for a tile BASE_TILE metres a side and stretched to the
 * island's own size, so every machine builds the same ground from the shape,
 * the seed and the size alone.
 */

export const SHAPE_IDS = [
  "plain",
  "headland",
  "crescent",
  "twin",
  "atoll",
  "spine",
  "mesa",
  "flats",
  "isles",
  "spire",
] as const;

export type ShapeId = (typeof SHAPE_IDS)[number];

export const isShapeId = (v: unknown): v is ShapeId =>
  typeof v === "string" && (SHAPE_IDS as readonly string[]).includes(v);

/* What lives on a hunting island and what grows there. */
export type BiomeId = "meadow" | "pinewood" | "ridge" | "marsh" | "fells";

/* One island on the grand map: where it is, how big, and what it looks like. */
export type IslandInfo = {
  id: number;
  shape: ShapeId;
  seed: number;
  /* The centre of its tile. */
  x: number;
  z: number;
  /* The tile's side, and the spacing of its height samples, in metres. */
  size: number;
  cell: number;
  /* Multiplies the shape's height: big islands stand a little taller so their slopes keep their character. */
  lift: number;
  name: string;
  /* The common ground in the middle of the map; see HARBOR. */
  harbor?: boolean;
  biome?: BiomeId;
};

/* Height samples a side for an island. */
export const gridOf = (o: { size: number; cell: number }) => Math.round(o.size / o.cell) + 1;

/*
 * The Harbor: common ground in the middle of the grand map. Everyone arrives
 * here, nobody owns it, and nobody can be hurt on it. One broad, gently
 * rolling island with the lighthouse on a low rise at its very centre.
 */
export const HARBOR_ID = 0;
export const HARBOR: IslandInfo = {
  id: HARBOR_ID,
  shape: "plain",
  seed: 83,
  x: 0,
  z: 0,
  size: 1000,
  cell: BASE_CELL,
  lift: 1,
  name: "the Harbor",
  harbor: true,
};

/* The hunting islands: a ring round the Harbor, a good row apart. */
const WILD_SIZE = 1400;
const WILD_CELL = 4.375;
const RING = 1800;
const wild = (
  id: number,
  name: string,
  biome: BiomeId,
  shape: ShapeId,
  seed: number,
  bearing: number,
  lift: number,
): IslandInfo => {
  const a = (bearing * Math.PI) / 180;
  return {
    id,
    shape,
    seed,
    x: Math.round(Math.sin(a) * RING),
    z: Math.round(-Math.cos(a) * RING),
    size: WILD_SIZE,
    cell: WILD_CELL,
    lift,
    name,
    biome,
  };
};

export const WORLD: readonly IslandInfo[] = [
  HARBOR,
  wild(1, "Fernmeadow", "meadow", "flats", 1201, 0, 1.6),
  wild(2, "Pinehollow", "pinewood", "headland", 2203, 72, 1.15),
  wild(3, "Greymane Ridge", "ridge", "spine", 3307, 144, 1.2),
  wild(4, "Bramble Marsh", "marsh", "twin", 4409, 216, 1.1),
  wild(5, "Hornback Fells", "fells", "mesa", 5501, 288, 1.35),
];

type Hill = { x: number; z: number; r: number; h: number };

/*
 * A shape's plan for one seed. `mask` takes warped coordinates and returns a
 * normalised distance from land: about 0.8 at the coast, 1.02 and beyond open
 * sea. `floor` (0..1) can make the sea shallower in places (a lagoon), and
 * `curve` reshapes the normalised height (a flat top, a sharp peak).
 */
type Plan = {
  hills: Hill[];
  mask: (x: number, z: number) => number;
  floor?: (x: number, z: number) => number;
  curve?: (t: number) => number;
};

type ShapeDef = {
  name: string;
  note: string;
  /* Domain warp, in metres: how ragged the coast is. */
  warp: number;
  /* Peak height as a share of MAX_HEIGHT. */
  height: number;
  base: number;
  roll: number;
  ridge: number;
  plan: (rng: Rng) => Plan;
};

const TAU = Math.PI * 2;

const hill = (angle: number, dist: number, r: number, h: number): Hill => ({
  x: Math.cos(angle) * dist,
  z: Math.sin(angle) * dist,
  r,
  h,
});

/* Distance from a point to a segment. */
function segment(px: number, pz: number, ax: number, az: number, bx: number, bz: number) {
  const dx = bx - ax;
  const dz = bz - az;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / (dx * dx + dz * dz)));
  return Math.hypot(px - ax - dx * t, pz - az - dz * t);
}

/* A smooth minimum, so joined shapes blend instead of meeting in a crease. */
function smin(a: number, b: number, k: number) {
  const h = Math.max(0, Math.min(1, 0.5 + (0.5 * (b - a)) / k));
  return b + (a - b) * h - k * h * (1 - h);
}

function wrapAngle(a: number) {
  while (a > Math.PI) a -= TAU;
  while (a < -Math.PI) a += TAU;
  return a;
}

export const SHAPES: Record<ShapeId, ShapeDef> = {
  plain: {
    name: "Plain",
    note: "One broad, whole island of gentle ground, rising a little to the middle.",
    warp: 34,
    height: 0.3,
    base: 0.3,
    roll: 0.22,
    ridge: 0.03,
    plan: (rng) => {
      const hills: Hill[] = [{ x: 0, z: 0, r: 75, h: 1 }];
      for (let k = 0; k < 9; k++)
        hills.push(
          hill(rng() * TAU, range(rng, 110, 230), range(rng, 26, 44), range(rng, 0.15, 0.35)),
        );
      return { hills, mask: (x, z) => Math.hypot(x, z) / 375 };
    },
  },
  headland: {
    name: "Headland",
    note: "One high massif ringed by lesser peaks. The original.",
    warp: 62,
    height: 1,
    base: 0.14,
    roll: 0.18,
    ridge: 0.09,
    /* Kept exactly as the first island was made, so old saves come back unchanged. */
    plan: (rng) => {
      const hills: Hill[] = [];
      hills.push(hill(rng() * TAU, rng() * 50, range(rng, 58, 72), 1));
      const peaks = 5 + Math.floor(rng() * 2);
      const turn = rng() * TAU;
      for (let p = 0; p < peaks; p++) {
        const angle = turn + ((p + range(rng, -0.25, 0.25)) / peaks) * TAU;
        hills.push(hill(angle, range(rng, 125, 195), range(rng, 34, 52), range(rng, 0.5, 0.78)));
      }
      for (let k = 0; k < 9; k++)
        hills.push(
          hill(rng() * TAU, range(rng, 60, 240), range(rng, 18, 34), range(rng, 0.18, 0.42)),
        );
      return { hills, mask: (x, z) => Math.hypot(x, z) / ISLAND_RADIUS };
    },
  },

  crescent: {
    name: "Crescent",
    note: "A long arc of hills wrapped round a sheltered bay.",
    warp: 38,
    height: 0.85,
    base: 0.16,
    roll: 0.16,
    ridge: 0.1,
    plan: (rng) => {
      const facing = rng() * TAU;
      const radius = range(rng, 150, 175);
      const width = range(rng, 82, 100);
      const span = range(rng, 1.7, 2.15);
      const hills: Hill[] = [];
      for (let k = -2; k <= 2; k++) {
        const a = facing + (k / 2) * span * range(rng, 0.8, 0.95);
        hills.push(
          hill(
            a,
            radius + range(rng, -15, 15),
            range(rng, 38, 54),
            range(rng, 0.55, 1) * (k ? 0.85 : 1),
          ),
        );
      }
      for (let k = 0; k < 6; k++)
        hills.push(
          hill(
            facing + range(rng, -span, span),
            radius + range(rng, -40, 40),
            range(rng, 16, 28),
            range(rng, 0.15, 0.35),
          ),
        );
      const ends = [-1, 1].map((side) => ({
        x: Math.cos(facing + side * span) * radius,
        z: Math.sin(facing + side * span) * radius,
      }));
      return {
        hills,
        mask: (x, z) => {
          const off = Math.abs(wrapAngle(Math.atan2(z, x) - facing));
          const dist =
            off <= span
              ? Math.abs(Math.hypot(x, z) - radius)
              : Math.min(...ends.map((e) => Math.hypot(x - e.x, z - e.z)));
          return (dist / width) * 0.8;
        },
      };
    },
  },

  twin: {
    name: "Twin peaks",
    note: "Two hills joined by a low neck of land.",
    warp: 46,
    height: 0.9,
    base: 0.12,
    roll: 0.16,
    ridge: 0.09,
    plan: (rng) => {
      const axis = rng() * TAU;
      const apart = range(rng, 120, 140);
      const c = Math.cos(axis);
      const s = Math.sin(axis);
      const a = { x: c * apart, z: s * apart };
      const b = { x: -c * apart, z: -s * apart };
      const ra = range(rng, 150, 175);
      const rb = range(rng, 130, 160);
      const neck = range(rng, 60, 80);
      const hills: Hill[] = [
        { ...a, r: range(rng, 50, 62), h: 1 },
        { ...b, r: range(rng, 44, 56), h: range(rng, 0.7, 0.9) },
      ];
      for (let k = 0; k < 6; k++) {
        const end = rng() < 0.5 ? a : b;
        const ang = rng() * TAU;
        const d = range(rng, 30, 100);
        hills.push({
          x: end.x + Math.cos(ang) * d,
          z: end.z + Math.sin(ang) * d,
          r: range(rng, 18, 30),
          h: range(rng, 0.15, 0.4),
        });
      }
      return {
        hills,
        mask: (x, z) => {
          const da = Math.hypot(x - a.x, z - a.z) / ra;
          const db = Math.hypot(x - b.x, z - b.z) / rb;
          const dn = segment(x, z, a.x, a.z, b.x, b.z) / neck;
          return smin(smin(da, db, 0.2), dn * 0.8, 0.25);
        },
      };
    },
  },

  atoll: {
    name: "Atoll",
    note: "A low ring of land round a calm, shallow lagoon.",
    warp: 30,
    height: 0.38,
    base: 0.22,
    roll: 0.14,
    ridge: 0.04,
    plan: (rng) => {
      const radius = range(rng, 180, 205);
      const width = range(rng, 46, 58);
      /* A pass or two through the reef, wide enough to row through. */
      const passes = Array.from({ length: rng() < 0.5 ? 1 : 2 }, () => rng() * TAU);
      const hills: Hill[] = [];
      const n = 8 + Math.floor(rng() * 4);
      for (let k = 0; k < n; k++)
        hills.push(
          hill(
            (k / n) * TAU + range(rng, -0.2, 0.2),
            radius + range(rng, -10, 10),
            range(rng, 22, 36),
            range(rng, 0.4, 1),
          ),
        );
      return {
        hills,
        mask: (x, z) => {
          const ang = Math.atan2(z, x);
          let gap = 0;
          for (const p of passes) {
            const off = Math.abs(wrapAngle(ang - p)) * radius;
            gap = Math.max(gap, 1 - smoothstep(6, 40, off));
          }
          return (Math.abs(Math.hypot(x, z) - radius) / width) * 0.8 + gap * 0.6;
        },
        floor: (x, z) => 0.3 + 0.7 * smoothstep(radius - 30, radius + 20, Math.hypot(x, z)),
      };
    },
  },

  spine: {
    name: "Spine",
    note: "A long ridge running end to end, steep to either side.",
    warp: 40,
    height: 0.95,
    base: 0.1,
    roll: 0.14,
    ridge: 0.2,
    plan: (rng) => {
      const axis = rng() * Math.PI;
      const c = Math.cos(axis);
      const s = Math.sin(axis);
      const long = range(rng, 285, 310);
      const wide = range(rng, 115, 140);
      const bend = range(rng, -0.0012, 0.0012);
      const hills: Hill[] = [];
      const n = 6;
      for (let k = 0; k < n; k++) {
        const u = ((k + 0.5) / n - 0.5) * long * 1.4;
        const v = bend * u * u;
        hills.push({
          x: u * c - v * s,
          z: u * s + v * c,
          r: range(rng, 36, 50),
          h: range(rng, 0.6, 1),
        });
      }
      return {
        hills,
        mask: (x, z) => {
          const u = x * c + z * s;
          const v = -x * s + z * c - bend * u * u;
          return Math.hypot(u / long, v / wide);
        },
      };
    },
  },

  mesa: {
    name: "Mesa",
    note: "A broad, high table of land with steep sides.",
    warp: 55,
    height: 0.7,
    base: 0.2,
    roll: 0.14,
    ridge: 0.05,
    plan: (rng) => {
      const hills: Hill[] = [hill(rng() * TAU, rng() * 30, range(rng, 115, 135), 1)];
      for (let k = 0; k < 5; k++)
        hills.push(
          hill(rng() * TAU, range(rng, 40, 150), range(rng, 25, 40), range(rng, 0.1, 0.25)),
        );
      const radius = range(rng, 255, 275);
      return {
        hills,
        mask: (x, z) => Math.hypot(x, z) / radius,
        /* Climbs fast from the shore, then levels off into a table with a little relief. */
        curve: (t) => 0.82 * smoothstep(0.08, 0.5, t) + 0.18 * t,
      };
    },
  },

  flats: {
    name: "Flats",
    note: "Low, gentle ground scattered with knolls. Easy walking.",
    warp: 85,
    height: 0.32,
    base: 0.3,
    roll: 0.3,
    ridge: 0.05,
    plan: (rng) => {
      const hills: Hill[] = [];
      for (let k = 0; k < 16; k++)
        hills.push(hill(rng() * TAU, range(rng, 0, 220), range(rng, 22, 45), range(rng, 0.2, 0.6)));
      return { hills, mask: (x, z) => Math.hypot(x, z) / 290 };
    },
  },

  isles: {
    name: "Isles",
    note: "A cluster of small islets with channels running between.",
    warp: 34,
    height: 0.6,
    base: 0.16,
    roll: 0.16,
    ridge: 0.08,
    plan: (rng) => {
      const discs: { x: number; z: number; r: number }[] = [];
      const want = 5 + Math.floor(rng() * 3);
      for (let tries = 0; tries < 400 && discs.length < want; tries++) {
        const r = range(rng, 80, discs.length ? 125 : 145);
        const ang = rng() * TAU;
        const d = discs.length ? range(rng, 60, 250 - r * 0.6) : range(rng, 0, 40);
        const x = Math.cos(ang) * d;
        const z = Math.sin(ang) * d;
        /* Leave a channel (about 25 m of water) between neighbours. */
        if (discs.some((o) => Math.hypot(o.x - x, o.z - z) < (o.r + r) * 0.8 + 25)) continue;
        discs.push({ x, z, r });
      }
      const hills = discs.map((o) => ({
        x: o.x,
        z: o.z,
        r: o.r * range(rng, 0.38, 0.5),
        h: range(rng, 0.45, 1),
      }));
      return {
        hills,
        mask: (x, z) => {
          let d = 9;
          for (const o of discs) d = Math.min(d, Math.hypot(x - o.x, z - o.z) / o.r);
          return d;
        },
      };
    },
  },

  spire: {
    name: "Spire",
    note: "One tall peak, steep on every side, with a skirt of lowland.",
    warp: 50,
    height: 1.25,
    base: 0.1,
    roll: 0.12,
    ridge: 0.14,
    plan: (rng) => {
      const hills: Hill[] = [hill(rng() * TAU, rng() * 25, range(rng, 48, 58), 1)];
      for (let k = 0; k < 7; k++)
        hills.push(
          hill(rng() * TAU, range(rng, 70, 190), range(rng, 22, 36), range(rng, 0.1, 0.24)),
        );
      return {
        hills,
        mask: (x, z) => Math.hypot(x, z) / 265,
        curve: (t) => t ** 1.45,
      };
    },
  },
};

/*
 * Heights for an island, n samples a side, laid over its whole tile (local
 * coordinates, centred on the island, in BASE_TILE units). The game uses the
 * island's own grid; the map draws from far fewer.
 */
export function islandHeights(shape: ShapeId, seed: number, n: number, lift = 1) {
  const def = SHAPES[shape];
  const rng = mulberry32(seed >>> 0);
  const rolling = createNoise2D(rng);
  const warp = createNoise2D(rng);
  const ridges = createNoise2D(rng);
  const plan = def.plan(rng);
  const half = BASE_TILE / 2;
  const cell = BASE_TILE / (n - 1);

  const raw = new Float32Array(n * n);
  const masks = new Float32Array(n * n);
  const floors = new Float32Array(n * n);
  let maxRaw = 0;

  for (let i = 0; i < n; i++) {
    const z = -half + i * cell;
    for (let j = 0; j < n; j++) {
      const x = -half + j * cell;
      const wx = x + warp(x * 0.005, z * 0.005) * def.warp;
      const wz = z + warp(x * 0.005 + 31.7, z * 0.005 - 12.3) * def.warp;
      const mask = 1 - smoothstep(0.55, 1.02, plan.mask(wx, wz));

      let h = 0;
      for (const o of plan.hills) {
        const dx = x - o.x;
        const dz = z - o.z;
        h += o.h * Math.exp(-(dx * dx + dz * dz) / (o.r * o.r));
      }
      const roll = fbm(rolling, x * 0.009, z * 0.009, 4);
      const ridge = 1 - Math.abs(fbm(ridges, x * 0.014, z * 0.014, 3));

      const v =
        mask * Math.max(0, def.base + h * 0.8 + roll * def.roll + ridge * ridge * def.ridge);
      const k = i * n + j;
      raw[k] = v;
      masks[k] = mask;
      floors[k] = plan.floor ? plan.floor(wx, wz) : 1;
      if (v > maxRaw) maxRaw = v;
    }
  }

  const out = new Float32Array(n * n);
  const top = MAX_HEIGHT * def.height * lift;
  for (let k = 0; k < raw.length; k++) {
    const t = raw[k] / maxRaw;
    const land = (plan.curve ? plan.curve(t) : t) * top - 1.4;
    /* Out past the coast the floor falls away to the open sea's depth (less in a lagoon). */
    const sea = (1 - masks[k]) * (SEA_FLOOR + 1.4);
    out[k] = land + sea * floors[k];
  }
  return out;
}

/* ---------- the grand map ---------- */

/* Do two islands' tiles overlap? Tiles may touch, but not share sea. */
export function tilesOverlap(a: IslandInfo, b: IslandInfo) {
  const reach = (a.size + b.size) / 2 - 0.01;
  return Math.abs(a.x - b.x) < reach && Math.abs(a.z - b.z) < reach;
}

export const islandById = (id: number) => WORLD.find((o) => o.id === id) ?? null;
