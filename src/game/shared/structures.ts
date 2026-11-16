import { ISLAND_RADIUS } from "./constants";
import { mulberry32, type Rng, range } from "./math";

/*
 * Buildings on the island. Each one is described as plain blocks (boxes and
 * cylinders, floors with hatches) plus ladders, so the same data drives
 * collision on the server and meshes on the client; the client adds
 * decoration (roofs, sails, lattice, lamps) on top. Everything that should
 * have an inside does: doorways, stairs, ladders up through hatches.
 */

export type StructureKind =
  | "lighthouse"
  | "windmill"
  | "chapel"
  | "mast"
  | "henge"
  | "watchtower"
  | "house"
  | "well"
  | "aqueduct"
  | "wreck"
  | "jetty";

export type Tone = "dark" | "mid" | "light";

export type Block = {
  shape: "box" | "cyl";
  x: number;
  z: number;
  bottom: number;
  top: number;
  /* Box: half extents along local x and z. Cylinder: bottom and top radius. */
  hx: number;
  hz: number;
  rot: number;
  tone: Tone;
  solid: boolean;
  standable: boolean;
  sides?: number;
  /* Collision only; the client draws something more detailed in its place. */
  hidden?: boolean;
  /* A round hatch through a floor, in the block's local space. */
  hole?: { lx: number; lz: number; r: number };
};

/* A ladder: stand at its foot and walk into it to climb. */
export type Ladder = { x: number; z: number; bottom: number; top: number; rot: number };

/* `ladder` marks a foothold reached by climbing rather than walking. */
export type Point = { x: number; y: number; z: number; ladder?: boolean };

/* A spot worth climbing to, with the footholds that lead up to it. */
export type Perch = Point & { route: Point[] };

export type Structure = {
  id: number;
  kind: StructureKind;
  x: number;
  y: number;
  z: number;
  rot: number;
  variant: number;
  /* Kind-specific measurements the client needs for decoration. */
  w: number;
  d: number;
  h: number;
  blocks: Block[];
  ladders: Ladder[];
  /* Small lamps inside, so interiors aren't pitch black. */
  lamps: Point[];
};

export type Footprint = { x: number; z: number; r: number };

export interface Site {
  readonly half: number;
  readonly cell: number;
  readonly heights: Float32Array;
  readonly lighthouse: Point;
  heightAt(x: number, z: number): number;
  normalAt(x: number, z: number): [number, number, number];
  levelPad(x: number, z: number, inner: number, outer: number, y: number): void;
}

export const LIGHTHOUSE = {
  plinthRadius: 6.4,
  plinthHeight: 1.15,
  towerRadius: 3.4,
  topRadius: 2.65,
  towerHeight: 17,
  bands: 7,
  galleryRadius: 4.1,
};

const STEP_RISE = 0.45;
const WALL = 0.4;

/* Local (structure space) to world. Matches three.js rotation.y. */
export function toWorld(cx: number, cz: number, rot: number, lx: number, lz: number) {
  const c = Math.cos(rot);
  const s = Math.sin(rot);
  return { x: cx + lx * c + lz * s, z: cz - lx * s + lz * c };
}

const polar = (cx: number, cz: number, a: number, r: number) => ({
  x: cx + Math.cos(a) * r,
  z: cz + Math.sin(a) * r,
});

function wrap(a: number) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

function box(
  x: number,
  z: number,
  bottom: number,
  top: number,
  hx: number,
  hz: number,
  rot: number,
  tone: Tone,
  standable = true,
  solid = true,
): Block {
  return { shape: "box", x, z, bottom, top, hx, hz, rot, tone, solid, standable };
}

function cyl(
  x: number,
  z: number,
  bottom: number,
  top: number,
  r: number,
  rTop: number,
  tone: Tone,
  sides: number,
  standable = false,
  solid = true,
  rot = 0,
): Block {
  return { shape: "cyl", x, z, bottom, top, hx: r, hz: rTop, rot, tone, solid, standable, sides };
}

/* A floor slab with a round hatch at world (hx, hz). */
function withHole(b: Block, wx: number, wz: number, r: number): Block {
  const dx = wx - b.x;
  const dz = wz - b.z;
  const c = Math.cos(b.rot);
  const s = Math.sin(b.rot);
  return { ...b, hole: { lx: dx * c - dz * s, lz: dx * s + dz * c, r } };
}

type Door = { a: number; bottom: number; top: number };

/*
 * A round wall built from flat panels, with doorways cut where asked. The
 * first door's angle sits on a panel centre so the opening is a full panel.
 */
function ring(
  B: Block[],
  o: {
    cx: number;
    cz: number;
    radius: number;
    bottom: number;
    top: number;
    segments: number;
    tone: Tone;
    doors?: Door[];
    a0?: number;
    thick?: number;
    standable?: boolean;
  },
) {
  const n = o.segments;
  const thick = o.thick ?? WALL;
  const mid = o.radius - thick / 2;
  const half = o.radius * Math.tan(Math.PI / n) + 0.02;
  const doors = o.doors ?? [];
  const a0 = o.a0 ?? doors[0]?.a ?? 0;
  for (let k = 0; k < n; k++) {
    const a = a0 + (k / n) * Math.PI * 2;
    let spans: [number, number][] = [[o.bottom, o.top]];
    for (const d of doors) {
      if (Math.abs(wrap(d.a - a)) > Math.PI / n) continue;
      spans = spans.flatMap(([b, t]): [number, number][] => {
        if (d.top <= b || d.bottom >= t) return [[b, t]];
        const out: [number, number][] = [];
        if (d.bottom > b) out.push([b, d.bottom]);
        if (d.top < t) out.push([d.top, t]);
        return out;
      });
    }
    const p = polar(o.cx, o.cz, a, mid);
    for (const [b, t] of spans) {
      if (t - b > 0.05)
        B.push(box(p.x, p.z, b, t, thick / 2, half, -a, o.tone, o.standable ?? true));
    }
  }
}

/* Straight walls of a rectangular room in structure space, with doorways. */
function room(
  B: Block[],
  o: {
    cx: number;
    cz: number;
    rot: number;
    w: number;
    d: number;
    bottom: number;
    top: number;
    tone: Tone;
    thick?: number;
    /* Doorways: which wall (by local axis sign), centre offset along it, width, height. */
    doors?: { side: "-z" | "+z" | "-x" | "+x"; at: number; width: number; height: number }[];
  },
) {
  const t = o.thick ?? 0.3;
  const walls: { side: "-z" | "+z" | "-x" | "+x"; len: number }[] = [
    { side: "-z", len: o.w },
    { side: "+z", len: o.w },
    { side: "-x", len: o.d - t },
    { side: "+x", len: o.d - t },
  ];
  for (const wall of walls) {
    const along = wall.side.endsWith("z") ? "x" : "z";
    const sign = wall.side.startsWith("-") ? -1 : 1;
    const offset = (wall.side.endsWith("z") ? o.d : o.w) - t / 2;
    /* Cut each doorway out of the wall's length. */
    let spans: [number, number][] = [[-wall.len, wall.len]];
    const door = (o.doors ?? []).filter((d) => d.side === wall.side);
    for (const d of door) {
      spans = spans.flatMap(([a, b]): [number, number][] => {
        const lo = d.at - d.width / 2;
        const hi = d.at + d.width / 2;
        if (hi <= a || lo >= b) return [[a, b]];
        const out: [number, number][] = [];
        if (lo > a) out.push([a, lo]);
        if (hi < b) out.push([hi, b]);
        return out;
      });
    }
    const piece = (a: number, b: number, bottom: number, top: number) => {
      const c = (a + b) / 2;
      const lx = along === "x" ? c : sign * offset;
      const lz = along === "x" ? sign * offset : c;
      const p = toWorld(o.cx, o.cz, o.rot, lx, lz);
      const hx = along === "x" ? (b - a) / 2 : t / 2;
      const hz = along === "x" ? t / 2 : (b - a) / 2;
      /* Standable tops, so you can step from a stair or crate onto a roof. */
      B.push(box(p.x, p.z, bottom, top, hx, hz, o.rot, o.tone, true));
    };
    for (const [a, b] of spans) piece(a, b, o.bottom, o.top);
    for (const d of door) piece(d.at - d.width / 2, d.at + d.width / 2, o.bottom + d.height, o.top);
  }
}

/*
 * A spiral stair of floating slabs round a central post, several turns if
 * need be (each turn rises ~5 m, plenty of headroom), ending in `flat` level
 * slabs that make the landing.
 */
function spiral(
  B: Block[],
  route: Point[],
  o: {
    cx: number;
    cz: number;
    rIn: number;
    rOut: (y: number) => number;
    y0: number;
    y1: number;
    a0: number;
    turn: number;
    flat: number;
    tone: Tone;
  },
) {
  const n = Math.floor((o.y1 - o.y0) / STEP_RISE);
  const rise = (o.y1 - o.y0) / (n + 1);
  let a = o.a0;
  for (let k = 1; k <= n + o.flat; k++) {
    a = o.a0 + k * o.turn;
    const top = k <= n ? o.y0 + k * rise : o.y1;
    const rOut = o.rOut(top);
    const rc = (o.rIn + rOut) / 2;
    const p = polar(o.cx, o.cz, a, rc);
    const width = rc * o.turn * 1.25;
    B.push(box(p.x, p.z, top - 0.3, top, (rOut - o.rIn) / 2 + 0.04, width / 2, -a, o.tone));
    route.push({ x: p.x, y: top, z: p.z });
  }
  return { aEnd: a, rise };
}

/* A straight flight of steps up the side of a wall, in structure space. */
function flight(
  site: Site,
  blocks: Block[],
  route: Point[],
  o: {
    cx: number;
    cz: number;
    rot: number;
    lx0: number;
    lx1: number;
    lz: number;
    y0: number;
    y1: number;
  },
) {
  const n = Math.max(1, Math.floor((o.y1 - o.y0) / STEP_RISE));
  const rise = (o.y1 - o.y0) / (n + 1);
  const run = (o.lx1 - o.lx0) / n;
  for (let k = 1; k <= n; k++) {
    const lx = o.lx0 + (k - 0.5) * run;
    const p = toWorld(o.cx, o.cz, o.rot, lx, o.lz);
    const top = o.y0 + k * rise;
    blocks.push(
      box(p.x, p.z, site.heightAt(p.x, p.z) - 0.6, top, Math.abs(run) / 2, 0.55, o.rot, "mid"),
    );
    route.push({ x: p.x, y: top, z: p.z });
  }
}

/* Add a ladder to a structure, and its two footholds to a route. */
function ladder(
  s: Structure,
  route: Point[] | null,
  x: number,
  z: number,
  bottom: number,
  top: number,
  rot: number,
) {
  s.ladders.push({ x, z, bottom, top: top + 0.05, rot });
  route?.push({ x, y: bottom, z }, { x, y: top + 0.05, z, ladder: true });
}

/* A thin rail of panels round a deck: knee-high, so a hard hit still clears it. */
function railRing(B: Block[], cx: number, cz: number, r: number, y: number, segments: number) {
  ring(B, {
    cx,
    cz,
    radius: r,
    bottom: y,
    top: y + 0.95,
    segments,
    tone: "dark",
    thick: 0.12,
    standable: false,
  });
}

/* Walk round a ring from one angle to another (the short way), as footholds. */
function arcRoute(
  route: Point[],
  cx: number,
  cz: number,
  r: number,
  y: number,
  a: number,
  b: number,
) {
  const d = wrap(b - a);
  const steps = Math.max(1, Math.ceil(Math.abs(d) / 0.45));
  for (let i = 1; i <= steps; i++) {
    const p = polar(cx, cz, a + (d * i) / steps, r);
    route.push({ x: p.x, y, z: p.z });
  }
}

export type Plan = { structures: Structure[]; perches: Perch[]; footprints: Footprint[] };

/* Which buildings to raise: the lighthouse, and/or everything else. */
export type PlanOptions = { lighthouse: boolean; landmarks: boolean };

export function planStructures(
  site: Site,
  seed: number,
  only: PlanOptions = { lighthouse: true, landmarks: true },
): Plan {
  const rng = mulberry32(seed ^ 0x7f4a7c15);
  const structures: Structure[] = [];
  const perches: Perch[] = [];
  const footprints: Footprint[] = only.lighthouse
    ? [{ x: site.lighthouse.x, z: site.lighthouse.z, r: 14 }]
    : [];
  let id = 0;

  const free = (x: number, z: number, r: number) =>
    footprints.every((f) => Math.hypot(f.x - x, f.z - z) > f.r + r);

  const add = (
    kind: StructureKind,
    x: number,
    y: number,
    z: number,
    rot: number,
    extra: { w?: number; d?: number; h?: number; variant?: number } = {},
  ): Structure => {
    const s: Structure = {
      id: id++,
      kind,
      x,
      y,
      z,
      rot,
      variant: extra.variant ?? Math.floor(rng() * 1e6),
      w: extra.w ?? 0,
      d: extra.d ?? 0,
      h: extra.h ?? 0,
      blocks: [],
      ladders: [],
      lamps: [],
    };
    structures.push(s);
    return s;
  };

  const flatness = (x: number, z: number, r: number) => {
    let lo = Number.POSITIVE_INFINITY;
    let hi = Number.NEGATIVE_INFINITY;
    let sum = 0;
    let n = 0;
    for (let a = 0; a < 8; a++) {
      for (const k of [0.5, 1]) {
        const h = site.heightAt(x + Math.cos(a * 0.785) * r * k, z + Math.sin(a * 0.785) * r * k);
        lo = Math.min(lo, h);
        hi = Math.max(hi, h);
        sum += h;
        n++;
      }
    }
    return { spread: hi - lo, mean: sum / n, lo };
  };

  /* ---------- the lighthouse on the summit ---------- */
  const lh = site.lighthouse;
  const lhRot = rng() * Math.PI * 2;
  if (only.lighthouse) build(site, add("lighthouse", lh.x, lh.y, lh.z, lhRot), perches, rng);
  if (!only.landmarks) return { structures, perches, footprints };

  /* ---------- landmarks on the secondary summits ---------- */
  const summits = findSummits(site).filter(
    (s) => Math.hypot(s.x - site.lighthouse.x, s.z - site.lighthouse.z) > 80,
  );
  const landmarks: StructureKind[] = shuffle(rng, ["windmill", "chapel", "mast", "henge"]);
  for (const s of summits) {
    if (!free(s.x, s.z, 30)) continue;
    const kind = landmarks.shift() ?? "watchtower";
    const rot = rng() * Math.PI * 2;
    const reach = kind === "henge" ? 22 : kind === "chapel" || kind === "mast" ? 18 : 12;
    site.levelPad(s.x, s.z, reach - 4, reach + 6, s.y);
    const st = add(kind, s.x, s.y, s.z, rot);
    build(site, st, perches, rng);
    footprints.push({ x: s.x, z: s.z, r: reach });
    if (landmarks.length === 0 && structures.length >= 6) break;
  }

  /* ---------- villages on gentle mid-height ground ---------- */
  for (let v = 0, tries = 0; v < 3 && tries < 600; tries++) {
    const a = rng() * Math.PI * 2;
    const dist = Math.sqrt(rng()) * ISLAND_RADIUS * 0.85;
    const cx = Math.cos(a) * dist;
    const cz = Math.sin(a) * dist;
    const h = site.heightAt(cx, cz);
    if (h < 4 || h > 24) continue;
    if (flatness(cx, cz, 12).spread > 5) continue;
    if (!free(cx, cz, 26)) continue;
    v++;
    const well = add("well", cx, h, cz, rng() * Math.PI);
    site.levelPad(cx, cz, 2.5, 6, h);
    build(site, well, perches, rng);
    footprints.push({ x: cx, z: cz, r: 4 });

    const count = 4 + Math.floor(rng() * 4);
    for (let k = 0, hTries = 0; k < count && hTries < 60; hTries++) {
      const ha = rng() * Math.PI * 2;
      const hd = range(rng, 9, 22);
      const x = cx + Math.cos(ha) * hd;
      const z = cz + Math.sin(ha) * hd;
      const w = range(rng, 2.6, 3.6);
      const d = range(rng, 2.1, 2.8);
      const r = Math.hypot(w, d) + 2.2;
      if (!free(x, z, r)) continue;
      const f = flatness(x, z, r);
      if (f.spread > 3.5 || f.lo < 1.2) continue;
      k++;
      /* Face the well. */
      const rot = Math.atan2(cx - x, cz - z) + Math.PI / 2;
      site.levelPad(x, z, r - 0.5, r + 4, f.mean);
      const st = add("house", x, f.mean, z, rot, {
        w,
        d,
        h: range(rng, 3, 3.8),
        variant: rng() < 0.62 ? 0 : 1,
      });
      build(site, st, perches, rng);
      footprints.push({ x, z, r });
    }
  }

  /* ---------- watchtowers scattered over the slopes ---------- */
  for (let n = 0, tries = 0; n < 4 && tries < 500; tries++) {
    const a = rng() * Math.PI * 2;
    const dist = Math.sqrt(rng()) * ISLAND_RADIUS * 0.9;
    const x = Math.cos(a) * dist;
    const z = Math.sin(a) * dist;
    const h = site.heightAt(x, z);
    if (h < 5 || h > 30) continue;
    if (flatness(x, z, 5).spread > 3) continue;
    if (!free(x, z, 40)) continue;
    n++;
    const f = flatness(x, z, 5);
    site.levelPad(x, z, 5.5, 10, f.mean);
    const st = add("watchtower", x, f.mean, z, rng() * Math.PI * 2);
    build(site, st, perches, rng);
    footprints.push({ x, z, r: 8 });
  }

  /* ---------- an aqueduct across a valley ---------- */
  aqueduct: for (let tries = 0; tries < 900; tries++) {
    const a = rng() * Math.PI * 2;
    const dist = Math.sqrt(rng()) * ISLAND_RADIUS * 0.8;
    const x0 = Math.cos(a) * dist;
    const z0 = Math.sin(a) * dist;
    const h0 = site.heightAt(x0, z0);
    if (h0 < 9 || h0 > 30) continue;
    const dir = rng() * Math.PI * 2;
    const dx = Math.cos(dir);
    const dz = Math.sin(dir);
    let low = h0;
    let dipped = false;
    for (let s = 2.5; s < 140; s += 2.5) {
      const g = site.heightAt(x0 + dx * s, z0 + dz * s);
      if (g > h0 + 0.8) continue aqueduct;
      low = Math.min(low, g);
      if (g < h0 - 2) dipped = true;
      if (dipped && g >= h0 - 0.4) {
        if (s < 40 || low > h0 - 7) continue aqueduct;
        for (let t = 0; t <= s; t += 6) {
          if (!free(x0 + dx * t, z0 + dz * t, 3)) continue aqueduct;
        }
        const mx = x0 + (dx * s) / 2;
        const mz = z0 + (dz * s) / 2;
        const top = h0 + 0.3;
        site.levelPad(x0 - dx * 2, z0 - dz * 2, 3, 8, top);
        site.levelPad(x0 + dx * (s + 2), z0 + dz * (s + 2), 3, 8, top);
        /* Local x runs along the span. */
        const st = add("aqueduct", mx, top, mz, -dir, { w: s / 2 + 2, d: 1.4, h: top });
        build(site, st, perches, rng);
        for (let t = 0; t <= s; t += 6) footprints.push({ x: x0 + dx * t, z: z0 + dz * t, r: 3.5 });
        break aqueduct;
      }
    }
  }

  /* ---------- shipwrecks on the beach, jetties into the sea ---------- */
  for (let n = 0, tries = 0; n < 2 && tries < 800; tries++) {
    const a = rng() * Math.PI * 2;
    const d = range(rng, ISLAND_RADIUS * 0.6, ISLAND_RADIUS * 1.05);
    const x = Math.cos(a) * d;
    const z = Math.sin(a) * d;
    const h = site.heightAt(x, z);
    if (h < 0.3 || h > 2) continue;
    if (flatness(x, z, 7).spread > 2.2) continue;
    if (!free(x, z, 30)) continue;
    n++;
    site.levelPad(x, z, 9, 14, h);
    const st = add("wreck", x, h, z, rng() * Math.PI * 2, { w: 8, d: 2.3, h: 2.4 });
    build(site, st, perches, rng);
    footprints.push({ x, z, r: 9 });
  }
  for (let n = 0, tries = 0; n < 2 && tries < 800; tries++) {
    const a = rng() * Math.PI * 2;
    const d = range(rng, ISLAND_RADIUS * 0.6, ISLAND_RADIUS * 1.05);
    const x = Math.cos(a) * d;
    const z = Math.sin(a) * d;
    const h = site.heightAt(x, z);
    if (h < 0.6 || h > 1.8) continue;
    /* Out to sea is away from the island's centre. */
    const ox = Math.cos(a);
    const oz = Math.sin(a);
    if (site.heightAt(x + ox * 26, z + oz * 26) > -2.5) continue;
    if (!free(x + ox * 14, z + oz * 14, 30)) continue;
    n++;
    const len = 28;
    const st = add("jetty", x + ox * (len / 2), h + 0.45, z + oz * (len / 2), -a, {
      w: len / 2,
      d: 1.2,
    });
    build(site, st, perches, rng);
    footprints.push({ x: x + ox * 14, z: z + oz * 14, r: 15 });
  }

  return { structures, perches, footprints };
}

function shuffle<T>(rng: Rng, items: T[]) {
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [items[i], items[j]] = [items[j], items[i]];
  }
  return items;
}

/* Local maxima of the height grid, tallest first, at least 70 m apart. */
function findSummits(site: Site) {
  const grid = Math.round(Math.sqrt(site.heights.length));
  const win = 12;
  const out: Point[] = [];
  for (let i = win; i < grid - win; i += 2) {
    for (let j = win; j < grid - win; j += 2) {
      const h = site.heights[i * grid + j];
      if (h < 12) continue;
      let top = true;
      for (let di = -win; di <= win && top; di += 2) {
        for (let dj = -win; dj <= win; dj += 2) {
          if (site.heights[(i + di) * grid + j + dj] > h) {
            top = false;
            break;
          }
        }
      }
      if (top) out.push({ x: -site.half + j * site.cell, y: h, z: -site.half + i * site.cell });
    }
  }
  out.sort((a, b) => b.y - a.y);
  const spaced: Point[] = [];
  for (const p of out)
    if (spaced.every((q) => Math.hypot(q.x - p.x, q.z - p.z) > 70)) spaced.push(p);
  return spaced;
}

function build(site: Site, s: Structure, perches: Perch[], rng: Rng) {
  const B = s.blocks;
  const { x, y, z, rot } = s;
  const at = (lx: number, lz: number) => toWorld(x, z, rot, lx, lz);
  /* World angle (round the centre) of a direction in structure space. */
  const angleOf = (lx: number, lz: number) => {
    const p = at(lx, lz);
    return Math.atan2(p.z - z, p.x - x);
  };
  const pt = (p: { x: number; z: number }, py: number, ladder = false): Point =>
    ladder ? { x: p.x, y: py, z: p.z, ladder } : { x: p.x, y: py, z: p.z };

  switch (s.kind) {
    case "lighthouse": {
      /*
       * Door at the foot, a spiral stair round a central post up to the watch
       * room, a door out onto the gallery, and a ladder up the outside to the
       * lantern deck: the highest point on the island.
       */
      const P = LIGHTHOUSE;
      const base = y + P.plinthHeight;
      const bandH = P.towerHeight / P.bands;
      const watch = base + bandH * (P.bands - 1);
      const cap = base + P.towerHeight;
      s.h = cap - y;
      const radiusAt = (b: number) =>
        P.towerRadius - (b / (P.bands - 1)) * (P.towerRadius - P.topRadius);
      const bandOf = (yy: number) =>
        Math.max(0, Math.min(P.bands - 1, Math.floor((yy - base) / bandH)));
      const turn = 0.55;
      const aDoor = rot;
      const a0 = aDoor + 1.1;
      const steps = Math.floor((watch - base) / STEP_RISE);
      /* The gallery door, snapped to a wall panel so the opening is a full panel wide. */
      const panel = (Math.PI * 2) / 16;
      const aTop = aDoor + Math.round((a0 + (steps + 3) * turn - aDoor) / panel) * panel;

      B.push(cyl(x, z, y - 3, base, P.plinthRadius, P.plinthRadius, "dark", 24, true));
      for (let b = 0; b < P.bands; b++) {
        ring(B, {
          cx: x,
          cz: z,
          radius: radiusAt(b),
          bottom: b === 0 ? y - 0.5 : base + b * bandH,
          top: base + (b + 1) * bandH,
          segments: 16,
          tone: b % 2 === 0 ? "light" : "dark",
          doors: [
            { a: aDoor, bottom: base - 1, top: base + 2.3 },
            { a: aTop, bottom: watch - 0.1, top: watch + 2.2 },
          ],
          a0: aDoor,
        });
      }
      B.push(cyl(x, z, base - 0.2, cap - 0.3, 0.45, 0.45, "dark", 10));

      const route: Point[] = [
        pt(polar(x, z, aDoor, P.towerRadius + 1.2), base),
        pt(polar(x, z, aDoor, 1.9), base),
      ];
      const stair: Point[] = [];
      spiral(B, stair, {
        cx: x,
        cz: z,
        rIn: 0.45,
        rOut: (yy) => radiusAt(bandOf(yy)) - WALL + 0.02,
        y0: base,
        y1: watch,
        a0,
        turn,
        flat: 6,
        tone: "mid",
      });
      route.push(...stair.slice(0, steps + 3));

      /* Gallery round the watch room, with a rail. */
      const outer = P.galleryRadius;
      ring(B, {
        cx: x,
        cz: z,
        radius: outer,
        thick: outer - P.topRadius + 0.12,
        bottom: watch - 0.3,
        top: watch,
        segments: 20,
        tone: "dark",
        standable: true,
      });
      railRing(B, x, z, outer, watch, 24);
      const walk = P.topRadius + 0.75;
      route.push(pt(polar(x, z, aTop, 1.6), watch), pt(polar(x, z, aTop, walk), watch));
      perches.push({ ...route[route.length - 1], route: [...route] });

      /* The ladder up to the lantern deck, opposite the gallery door. */
      const aLad = aTop + Math.PI;
      const foot = polar(x, z, aLad, P.topRadius + 0.42);
      arcRoute(route, x, z, walk, watch, aTop, aLad);
      ladder(s, route, foot.x, foot.z, watch, cap, -aLad);
      B.push(
        withHole(
          cyl(x, z, cap - 0.3, cap, P.topRadius + 0.35, P.topRadius + 0.35, "light", 16, true),
          foot.x,
          foot.z,
          0.7,
        ),
      );
      route.push(pt(polar(x, z, aLad, 1.5), cap));
      perches.push({ ...route[route.length - 1], route });

      for (let k = 0; k < 4; k++) {
        const ly = base + 2.2 + k * 4;
        s.lamps.push(
          pt(polar(x, z, aDoor + 0.5 + k * 1.7, radiusAt(bandOf(ly)) - WALL - 0.08), ly),
        );
      }
      break;
    }
    case "windmill": {
      /* Three floors joined by ladders, a balcony on the first, sails above. */
      const R = 3.3;
      s.h = 12;
      s.w = R;
      const f1 = y + 5.6;
      const f2 = y + 10;
      const inner = R - WALL;
      const aDoor = angleOf(0, 1);
      const aBal = aDoor + Math.PI / 2;
      ring(B, {
        cx: x,
        cz: z,
        radius: R,
        bottom: y - 0.5,
        top: y + s.h,
        segments: 16,
        tone: "light",
        doors: [
          { a: aDoor, bottom: y - 1, top: y + 2.2 },
          { a: aBal, bottom: f1 - 0.1, top: f1 + 2.1 },
        ],
      });
      B.push(cyl(x, z, y + s.h, y + s.h + 0.3, R, R, "dark", 16));
      const aL1 = aDoor + 2.2;
      const aL2 = aL1 + Math.PI;
      const l1 = polar(x, z, aL1, inner - 0.55);
      const l2 = polar(x, z, aL2, inner - 0.55);
      B.push(
        withHole(
          cyl(x, z, f1 - 0.3, f1, inner + 0.05, inner + 0.05, "mid", 16, true),
          l1.x,
          l1.z,
          0.7,
        ),
      );
      B.push(
        withHole(
          cyl(x, z, f2 - 0.3, f2, inner + 0.05, inner + 0.05, "mid", 16, true),
          l2.x,
          l2.z,
          0.7,
        ),
      );
      ring(B, {
        cx: x,
        cz: z,
        radius: R + 1.5,
        thick: 1.6,
        bottom: f1 - 0.3,
        top: f1,
        segments: 20,
        tone: "dark",
        standable: true,
      });
      railRing(B, x, z, R + 1.5, f1, 24);

      /* Millstones upstairs, sacks of grain downstairs. */
      const mill = polar(x, z, aL1 - 1.7, 1.2);
      B.push(cyl(mill.x, mill.z, f1, f1 + 0.45, 0.95, 0.95, "dark", 14, true));
      for (const [a, r] of [
        [aDoor - 1.4, 2.1],
        [aDoor - 1.9, 2.1],
      ]) {
        const p = polar(x, z, a, r);
        B.push(box(p.x, p.z, y - 0.2, y + 0.75, 0.4, 0.3, -a, "mid"));
      }

      const route: Point[] = [pt(polar(x, z, aDoor, R + 1.2), y), pt(polar(x, z, aDoor, 1.7), y)];
      ladder(s, route, l1.x, l1.z, y, f1, -aL1);
      const toBalcony = [
        ...route,
        pt(polar(x, z, aBal, inner - 0.7), f1),
        pt(polar(x, z, aBal, R + 0.8), f1),
      ];
      perches.push({ ...toBalcony[toBalcony.length - 1], route: toBalcony });
      ladder(s, route, l2.x, l2.z, f1, f2, -aL2);
      route.push(pt(polar(x, z, aL2 + 1.6, 1.3), f2));
      perches.push({ ...route[route.length - 1], route });

      s.lamps.push(
        pt(polar(x, z, aDoor + 1, inner - 0.08), y + 2.4),
        pt(polar(x, z, aL1 + 1, inner - 0.08), f1 + 1.9),
        pt(polar(x, z, aL2 - 1, inner - 0.08), f2 + 1.5),
      );
      break;
    }
    case "chapel": {
      /* A nave with pews and an altar, and a bell tower climbed by ladders. */
      s.w = 3.3;
      s.d = 6;
      s.h = 5;
      room(B, {
        cx: x,
        cz: z,
        rot,
        w: s.w,
        d: s.d,
        bottom: y - 0.6,
        top: y + s.h,
        tone: "light",
        thick: 0.35,
        doors: [{ side: "-z", at: 0, width: 1.6, height: 2.8 }],
      });
      for (let row = 0; row < 4; row++) {
        for (const side of [-1, 1]) {
          const p = at(side * 1.6, -s.d + 2.6 + row * 1.5);
          B.push(box(p.x, p.z, y - 0.2, y + 0.5, 0.95, 0.24, rot, "dark"));
        }
      }
      const altar = at(0, s.d - 1.2);
      B.push(box(altar.x, altar.z, y - 0.2, y + 1, 1.2, 0.45, rot, "mid"));
      for (const side of [-1, 1]) {
        s.lamps.push(
          pt(at(side * 0.9, s.d - 1.2), y + 1.2),
          pt(at(side * (s.w - 0.4), 0), y + 3.4),
        );
      }

      const half = 2.3;
      const t = at(0, -s.d - 4.6);
      const tw = (lx: number, lz: number) => toWorld(t.x, t.z, rot, lx, lz);
      room(B, {
        cx: t.x,
        cz: t.z,
        rot,
        w: half,
        d: half,
        bottom: y - 0.6,
        top: y + 10,
        tone: "light",
        thick: 0.35,
        doors: [{ side: "+z", at: 0, width: 1.3, height: 2.3 }],
      });
      const l1 = tw(-1.3, -0.7);
      const l2 = tw(1.3, -0.7);
      B.push(withHole(box(t.x, t.z, y + 4.7, y + 5, half, half, rot, "mid"), l1.x, l1.z, 0.7));
      B.push(withHole(box(t.x, t.z, y + 9.7, y + 10, half, half, rot, "mid"), l2.x, l2.z, 0.7));
      /* Belfry: corner posts and a low parapet; a good hit still clears it. */
      for (const [cx, cz] of [
        [-1, -1],
        [1, -1],
        [-1, 1],
        [1, 1],
      ]) {
        const p = tw(cx * (half - 0.22), cz * (half - 0.22));
        B.push(box(p.x, p.z, y + 10, y + 12.6, 0.22, 0.22, rot, "light", false));
      }
      for (const [lx, lz, alongX] of [
        [0, -half + 0.08, 1],
        [0, half - 0.08, 1],
        [-half + 0.08, 0, 0],
        [half - 0.08, 0, 0],
      ]) {
        const p = tw(lx, lz);
        B.push(
          box(
            p.x,
            p.z,
            y + 10,
            y + 10.75,
            alongX ? half - 0.45 : 0.08,
            alongX ? 0.08 : half - 0.45,
            rot,
            "light",
            false,
          ),
        );
      }
      B.push(box(t.x, t.z, y + 12.6, y + 13.1, half + 0.15, half + 0.15, rot, "dark", false));
      B.push(cyl(t.x, t.z, y + 13.1, y + 19, 2.9, 0.02, "dark", 4, false, true, rot + Math.PI / 4));

      const route: Point[] = [pt(tw(0, half + 1.2), y), pt(tw(0, half - 0.9), y)];
      ladder(s, route, l1.x, l1.z, y, y + 5, rot);
      ladder(s, route, l2.x, l2.z, y + 5, y + 10, rot);
      route.push(pt(tw(0.2, 0.6), y + 10));
      perches.push({ ...route[route.length - 1], route });
      s.lamps.push(pt(tw(-half + 0.45, 0.8), y + 2.3), pt(tw(half - 0.45, 0.8), y + 7.2));
      break;
    }
    case "mast": {
      /*
       * A lattice mast climbed by a ladder up its middle: a service platform
       * on the way, a small deck at the top. An equipment hut beside it.
       */
      s.h = 36;
      const svc = y + 9;
      const top = y + 28;
      for (let i = 0; i < 3; i++) {
        const a = rot + (i / 3) * Math.PI * 2;
        for (let h0 = 0; h0 < 28; h0 += 6) {
          const r = 1.8 - 0.9 * (Math.min(28, h0 + 3) / 28);
          const p = polar(x, z, a, r);
          B.push({
            ...cyl(p.x, p.z, y + h0 - 0.5, y + Math.min(28.2, h0 + 6), 0.14, 0.14, "dark", 6),
            hidden: true,
          });
        }
      }
      B.push(withHole(cyl(x, z, svc - 0.3, svc, 3, 3, "dark", 12, true), x, z, 0.75));
      railRing(B, x, z, 3, svc, 16);
      B.push(withHole(cyl(x, z, top - 0.3, top, 1.75, 1.75, "dark", 12, true), x, z, 0.75));
      railRing(B, x, z, 1.75, top, 12);

      const lower: Point[] = [];
      ladder(s, lower, x, z, y, top, rot);
      const svcRoute = [lower[0], pt({ x, z }, svc + 0.1, true), pt(polar(x, z, rot, 2.1), svc)];
      perches.push({ ...svcRoute[2], route: svcRoute });
      lower.push(pt(polar(x, z, rot, 1.3), top));
      perches.push({ ...lower[2], route: lower });

      /* The hut: a room with a desk, a flat roof reached from a crate. */
      const hut = at(9, 0);
      room(B, {
        cx: hut.x,
        cz: hut.z,
        rot,
        w: 2.2,
        d: 1.6,
        bottom: y - 0.6,
        top: y + 2.6,
        tone: "light",
        thick: 0.25,
        doors: [{ side: "-z", at: 0.6, width: 1.1, height: 2.1 }],
      });
      B.push(box(hut.x, hut.z, y + 2.6, y + 2.9, 2.2, 1.6, rot, "light"));
      const desk = at(8.4, 0.9);
      B.push(box(desk.x, desk.z, y - 0.2, y + 0.8, 0.9, 0.35, rot, "dark"));
      const low = at(9.4, 3.3);
      const high = at(9.4, 2.05);
      B.push(box(low.x, low.z, y - 0.4, y + 1, 0.6, 0.55, rot + 0.2, "mid"));
      B.push(box(high.x, high.z, y - 0.4, y + 2, 0.5, 0.45, rot, "mid"));
      perches.push({
        x: hut.x,
        y: y + 2.9,
        z: hut.z,
        route: [pt(low, y + 1), pt(high, y + 2), { x: hut.x, y: y + 2.9, z: hut.z }],
      });
      s.lamps.push(pt(at(9, 0), y + 2.3));
      break;
    }
    case "henge": {
      /* A ring of trilithons; tumbled stones make a scramble up to one lintel. */
      const R = 12;
      const n = 9;
      const climb = Math.floor(rng() * n);
      B.push(box(x, z, y - 0.5, y + 0.8, 1.3, 0.7, rot, "mid"));
      for (let k = 0; k < n; k++) {
        const a = rot + (k / n) * Math.PI * 2;
        const tangent = -a + Math.PI / 2;
        const cx = x + Math.cos(a) * R;
        const cz = z + Math.sin(a) * R;
        const lean = rng() < 0.2 && k !== climb;
        if (lean) {
          const p = toWorld(cx, cz, tangent, -0.9, 0);
          B.push(box(p.x, p.z, y - 1, y + 4, 0.5, 0.36, tangent, "mid", false));
          const q = toWorld(cx, cz, tangent, 0.6, 2.2);
          B.push(box(q.x, q.z, y - 0.3, y + 0.5, 1.5, 0.42, tangent + 0.4, "mid"));
          continue;
        }
        for (const side of [-0.9, 0.9]) {
          const p = toWorld(cx, cz, tangent, side, 0);
          B.push(box(p.x, p.z, y - 1, y + 4, 0.5, 0.36, tangent, "mid", false));
        }
        B.push(box(cx, cz, y + 4, y + 4.75, 1.6, 0.42, tangent, "mid"));
        if (k === climb) {
          const route: Point[] = [];
          for (const [dist, top] of [
            [4.6, 1.2],
            [3.2, 2.4],
            [1.8, 3.6],
          ]) {
            const sx = x + Math.cos(a) * (R + dist);
            const sz = z + Math.sin(a) * (R + dist);
            B.push(box(sx, sz, y - 0.5, y + top, 0.7, 0.7, tangent + top * 0.12, "mid"));
            route.push({ x: sx, y: y + top, z: sz });
          }
          route.push({ x: cx, y: y + 4.75, z: cz });
          perches.push({ x: cx, y: y + 4.75, z: cz, route });
        }
      }
      break;
    }
    case "watchtower": {
      /* Timber legs, a ladder up the middle through a hatch, a railed deck under a roof. */
      s.h = 9;
      const deck = y + s.h;
      for (const [lx, lz] of [
        [-1.6, -1.6],
        [1.6, -1.6],
        [-1.6, 1.6],
        [1.6, 1.6],
      ]) {
        const p = at(lx, lz);
        B.push(box(p.x, p.z, y - 0.5, deck - 0.35, 0.24, 0.24, rot, "dark", false));
      }
      B.push(
        withHole(
          cyl(x, z, deck - 0.35, deck, 2.95, 2.95, "dark", 8, true, true, rot + Math.PI / 8),
          x,
          z,
          0.75,
        ),
      );
      railRing(B, x, z, 2.7, deck, 16);
      for (const [lx, lz] of [
        [-1.8, -1.8],
        [1.8, -1.8],
        [-1.8, 1.8],
        [1.8, 1.8],
      ]) {
        const p = at(lx, lz);
        B.push(box(p.x, p.z, deck, deck + 2.4, 0.1, 0.1, rot, "dark", false));
      }
      B.push(
        cyl(x, z, deck + 2.4, deck + 4.2, 3.3, 0.05, "dark", 4, false, true, rot + Math.PI / 4),
      );
      const route: Point[] = [];
      ladder(s, route, x, z, y, deck, rot);
      route.push(pt(polar(x, z, rot, 1.6), deck));
      perches.push({ ...route[route.length - 1], route });
      break;
    }
    case "house": {
      /* A room with a door, a bed and a table; flat roofs have a hatch and ladder too. */
      const { w, d, h } = s;
      room(B, {
        cx: x,
        cz: z,
        rot,
        w,
        d,
        bottom: y - 0.6,
        top: y + h,
        tone: "light",
        thick: 0.25,
        doors: [{ side: "-z", at: range(rng, 0.25, w * 0.45), width: 1.1, height: 2.2 }],
      });
      const bed = at(-w + 1.3, d - 0.75);
      B.push(box(bed.x, bed.z, y - 0.2, y + 0.5, 0.95, 0.45, rot, "mid"));
      const table = at(w * 0.35, 0.3);
      B.push(box(table.x, table.z, y - 0.2, y + 0.8, 0.55, 0.4, rot, "dark"));
      s.lamps.push(pt(at(0, 0), y + h - 0.45));
      if (s.variant === 0) {
        const hatch = at(-w + 0.65, -d + 0.65);
        B.push(withHole(box(x, z, y + h - 0.3, y + h, w, d, rot, "light"), hatch.x, hatch.z, 0.6));
        ladder(s, null, hatch.x, hatch.z, y, y + h, rot);
        /* And an outside stair along the back wall. */
        const route: Point[] = [];
        flight(site, B, route, {
          cx: x,
          cz: z,
          rot,
          lx0: -w + 0.2,
          lx1: w - 0.4,
          lz: d + 0.62,
          y0: y,
          y1: y + h,
        });
        route.push(pt(at(w * 0.4, 0), y + h));
        perches.push({ ...route[route.length - 1], route });
      }
      break;
    }
    case "well": {
      B.push(cyl(x, z, y - 0.5, y + 0.85, 1.15, 1.15, "light", 12, true));
      break;
    }
    case "aqueduct": {
      /* Piers every few metres carrying a deck; the arches between are decoration. */
      const half = s.w;
      const top = s.h;
      B.push(box(x, z, top - 0.8, top, half, s.d, rot, "light"));
      const spans = Math.max(2, Math.round((half * 2) / 7));
      for (let k = 0; k <= spans; k++) {
        const lx = -half + (k / spans) * half * 2;
        const p = at(lx, 0);
        const g = site.heightAt(p.x, p.z);
        if (g > top - 1.6) continue;
        B.push(box(p.x, p.z, g - 1.2, top - 0.8, 0.85, s.d, rot, "light", false));
      }
      s.variant = spans;
      const end = at(-half + 1, 0);
      const mid = at(0, 0);
      perches.push({
        x: mid.x,
        y: top,
        z: mid.z,
        route: [
          { x: end.x, y: top, z: end.z },
          { x: mid.x, y: top, z: mid.z },
        ],
      });
      break;
    }
    case "wreck": {
      /*
       * A beached hull you can walk into through its stove-in side; a ladder
       * inside climbs to what's left of the deck.
       */
      const L = s.w;
      const W = s.d;
      const wall = (lx0: number, lx1: number, lz: number) => {
        const p = at((lx0 + lx1) / 2, lz);
        B.push({
          ...box(p.x, p.z, y - 0.4, y + 2.6, (lx1 - lx0) / 2, 0.12, rot, "dark", true),
          hidden: true,
        });
      };
      wall(-0.78 * L, 0.78 * L, -W + 0.25);
      wall(-0.78 * L, -0.43 * L, W - 0.25);
      wall(0.29 * L, 0.78 * L, W - 0.25);
      for (const end of [-1, 1]) {
        const p = at(end * 0.86 * L, 0);
        B.push({
          ...box(p.x, p.z, y - 0.4, y + 2.6, 0.15, W * 0.55, rot, "dark", false),
          hidden: true,
        });
      }
      const deck = at(0.46 * L, 0);
      const lad = at(0.2 * L, 0);
      B.push(
        withHole(
          box(deck.x, deck.z, y + s.h - 0.2, y + s.h, 0.34 * L, W - 0.3, rot, "mid"),
          lad.x,
          lad.z,
          0.6,
        ),
      );
      ladder(s, null, lad.x, lad.z, y, y + s.h, rot);
      /* Two crates stacked against the hole in the side: a scramble up onto the deck. */
      const low = at(1.5, W + 1.45);
      const high = at(1.5, W + 0.15);
      B.push(box(low.x, low.z, y - 0.4, y + 1, 0.6, 0.55, rot + 0.15, "mid"));
      B.push(box(high.x, high.z, y - 0.4, y + 1.95, 0.45, 0.45, rot, "mid"));
      const top = at(0.6 * L, 0);
      perches.push({
        ...pt(top, y + s.h),
        route: [pt(low, y + 1), pt(high, y + 1.95), pt(at(1.5, 1), y + s.h), pt(top, y + s.h)],
      });
      s.lamps.push(pt(at(-0.2 * L, 0), y + 1.6));
      break;
    }
    case "jetty": {
      B.push(box(x, z, y - 0.35, y, s.w, s.d, rot, "mid"));
      break;
    }
  }
}
