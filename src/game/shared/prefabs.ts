import { PLAYER_RADIUS, SEA_LEVEL } from "./constants";
import type { ItemId, KitId } from "./items";
import type { Block, Tone } from "./structures";
import { toWorld } from "./structures";
import type { Ground, Solid } from "./terrain";

/*
 * Things you can build. Each kind is laid out as plain blocks in its own
 * space (origin at floor level, front toward +z), so the room turns them into
 * collision exactly as it does the island's own buildings, and the client
 * builds one model per kind and draws every copy of it at once.
 */

export type Prefab = {
  id: number;
  kind: KitId;
  x: number;
  y: number;
  z: number;
  rot: number;
  /* A chest's contents. */
  store?: Partial<Record<ItemId, number>>;
};

type Placing = "land" | "shore" | "water";

type PrefabDef = {
  /* Footprint, in local space: half width, and the near and far edges along z. */
  hx: number;
  z0: number;
  z1: number;
  /* How tall it stands, for clearance. */
  height: number;
  /* Most the ground may vary under it. */
  spread: number;
  placing: Placing;
  /* Can go on a floor (inside a hut, on a dock), not only on the ground. */
  onFloors: boolean;
};

export const PREFABS: Record<KitId, PrefabDef> = {
  campfire: {
    hx: 0.6,
    z0: -0.6,
    z1: 0.6,
    height: 1,
    spread: 0.6,
    placing: "land",
    onFloors: false,
  },
  chest: {
    hx: 0.5,
    z0: -0.35,
    z1: 0.35,
    height: 0.7,
    spread: 0.6,
    placing: "land",
    onFloors: true,
  },
  bed: { hx: 0.55, z0: -1.05, z1: 1.05, height: 1, spread: 0.6, placing: "land", onFloors: true },
  hut: { hx: 2, z0: -2, z1: 2, height: 3.2, spread: 1.3, placing: "land", onFloors: false },
  cabin: { hx: 2.8, z0: -3.4, z1: 4.9, height: 3.6, spread: 1.4, placing: "land", onFloors: false },
  dock: { hx: 1.3, z0: -12.4, z1: 0.2, height: 1, spread: 99, placing: "shore", onFloors: false },
};

/* The dock's planks sit this far above the sea. */
export const DOCK_DECK = SEA_LEVEL + 0.9;
/* Building reach, and how many things one island holds. */
export const BUILD_REACH = 9;
export const MAX_PREFABS = 60;
/* Within this of a campfire you heal quickly. */
export const CAMPFIRE_WARMTH = 4.5;

type Local = {
  lx: number;
  lz: number;
  bottom: number;
  top: number;
  hx: number;
  hz: number;
  tone: Tone;
  shape?: "box" | "cyl";
  standable?: boolean;
  solid?: boolean;
  hidden?: boolean;
};

const FOUNDATION = 1.5;

/* A box wall run along x (at lz) or along z (at lx), with gaps cut out of it. */
function wall(
  out: Local[],
  o: {
    axis: "x" | "z";
    at: number;
    from: number;
    to: number;
    bottom: number;
    top: number;
    gaps?: { a: number; b: number; bottom: number; top: number }[];
  },
) {
  const t = 0.075;
  const piece = (a: number, b: number, bottom: number, top: number) => {
    if (b - a < 0.02 || top - bottom < 0.02) return;
    const c = (a + b) / 2;
    const half = (b - a) / 2;
    out.push(
      o.axis === "x"
        ? { lx: c, lz: o.at, bottom, top, hx: half, hz: t, tone: "mid", standable: true }
        : { lx: o.at, lz: c, bottom, top, hx: t, hz: half, tone: "mid", standable: true },
    );
  };
  let spans: [number, number][] = [[o.from, o.to]];
  for (const g of o.gaps ?? []) {
    spans = spans.flatMap(([a, b]): [number, number][] =>
      g.b <= a || g.a >= b
        ? [[a, b]]
        : [
            ...(g.a > a ? [[a, g.a] as [number, number]] : []),
            ...(g.b < b ? [[g.b, b] as [number, number]] : []),
          ],
    );
    piece(Math.max(g.a, o.from), Math.min(g.b, o.to), o.bottom, g.bottom);
    piece(Math.max(g.a, o.from), Math.min(g.b, o.to), g.top, o.top);
  }
  for (const [a, b] of spans) piece(a, b, o.bottom, o.top);
}

/* Four walls on a floor, with a door in the front. */
function shell(out: Local[], hx: number, hz: number, height: number, windows: boolean) {
  const floor = 0.2;
  const top = floor + height;
  const t = 0.075;
  const door = { a: -0.5, b: 0.5, bottom: floor - 0.1, top: floor + 2.1 };
  const window = (a: number, b: number) => ({ a, b, bottom: floor + 1, top: floor + 1.9 });
  wall(out, { axis: "x", at: -hz + t, from: -hx, to: hx, bottom: floor, top });
  wall(out, { axis: "x", at: hz - t, from: -hx, to: hx, bottom: floor, top, gaps: [door] });
  for (const s of [-1, 1])
    wall(out, {
      axis: "z",
      at: s * (hx - t),
      from: -hz + 2 * t,
      to: hz - 2 * t,
      bottom: floor,
      top,
      gaps: windows ? [window(-0.8, 0.8)] : [],
    });
  out.push({
    lx: 0,
    lz: 0,
    bottom: top,
    top: top + 0.12,
    hx: hx + 0.1,
    hz: hz + 0.1,
    tone: "dark",
    standable: true,
  });
}

function layout(kind: KitId): Local[] {
  const out: Local[] = [];
  switch (kind) {
    case "campfire":
      /* Collision only: the client draws stones, logs and a flame. */
      out.push({
        lx: 0,
        lz: 0,
        bottom: -0.1,
        top: 0.35,
        hx: 0.5,
        hz: 0.5,
        tone: "dark",
        shape: "cyl",
        hidden: true,
      });
      break;
    case "chest":
      out.push({
        lx: 0,
        lz: 0,
        bottom: 0,
        top: 0.42,
        hx: 0.45,
        hz: 0.28,
        tone: "mid",
        standable: true,
      });
      out.push({
        lx: 0,
        lz: 0,
        bottom: 0.42,
        top: 0.58,
        hx: 0.47,
        hz: 0.3,
        tone: "dark",
        standable: true,
      });
      break;
    case "bed":
      out.push({
        lx: 0,
        lz: 0.05,
        bottom: 0,
        top: 0.42,
        hx: 0.5,
        hz: 0.98,
        tone: "mid",
        standable: true,
      });
      out.push({ lx: 0, lz: -0.98, bottom: 0, top: 0.95, hx: 0.52, hz: 0.06, tone: "dark" });
      out.push({
        lx: 0,
        lz: -0.65,
        bottom: 0.42,
        top: 0.56,
        hx: 0.36,
        hz: 0.18,
        tone: "light",
        solid: false,
      });
      out.push({
        lx: 0,
        lz: 0.35,
        bottom: 0.42,
        top: 0.5,
        hx: 0.48,
        hz: 0.6,
        tone: "light",
        solid: false,
      });
      break;
    case "hut":
      out.push({
        lx: 0,
        lz: 0,
        bottom: -FOUNDATION,
        top: 0.2,
        hx: 1.9,
        hz: 1.9,
        tone: "dark",
        standable: true,
      });
      shell(out, 1.9, 1.9, 2.5, false);
      break;
    case "cabin":
      out.push({
        lx: 0,
        lz: 0,
        bottom: -FOUNDATION,
        top: 0.2,
        hx: 2.7,
        hz: 3.3,
        tone: "dark",
        standable: true,
      });
      shell(out, 2.7, 3.3, 2.8, true);
      /* The porch: a lower deck out front and two posts. */
      out.push({
        lx: 0,
        lz: 4.05,
        bottom: -FOUNDATION,
        top: 0.15,
        hx: 2.7,
        hz: 0.75,
        tone: "mid",
        standable: true,
      });
      for (const s of [-1, 1])
        out.push({
          lx: s * 2.5,
          lz: 4.6,
          bottom: 0.15,
          top: 2.7,
          hx: 0.08,
          hz: 0.08,
          tone: "dark",
        });
      break;
    case "dock":
      out.push({
        lx: 0,
        lz: -6.1,
        bottom: -0.18,
        top: 0,
        hx: 1.2,
        hz: 6.2,
        tone: "mid",
        standable: true,
      });
      for (const lz of [-0.6, -3.6, -6.6, -9.6, -12.1])
        for (const s of [-1, 1])
          out.push({
            lx: s * 1.1,
            lz,
            bottom: -6,
            top: -0.18,
            hx: 0.12,
            hz: 0.12,
            tone: "dark",
            shape: "cyl",
          });
      /* Knee-high rails along the sides, open at the end. */
      for (const s of [-1, 1])
        out.push({ lx: s * 1.15, lz: -7.5, bottom: 0, top: 0.85, hx: 0.04, hz: 4.6, tone: "dark" });
      break;
  }
  return out;
}

const LAYOUTS = new Map<KitId, Local[]>();
function layoutOf(kind: KitId) {
  let l = LAYOUTS.get(kind);
  if (!l) {
    l = layout(kind);
    LAYOUTS.set(kind, l);
  }
  return l;
}

/* The blocks of a kind in its own space, for building a model. */
export function localBlocks(kind: KitId): Block[] {
  return prefabBlocks({ id: 0, kind, x: 0, y: 0, z: 0, rot: 0 });
}

export function prefabBlocks(
  p: Pick<Prefab, "kind" | "x" | "y" | "z" | "rot"> & { id: number },
): Block[] {
  return layoutOf(p.kind).map((l) => {
    const w = toWorld(p.x, p.z, p.rot, l.lx, l.lz);
    return {
      shape: l.shape ?? "box",
      x: w.x,
      z: w.z,
      bottom: p.y + l.bottom,
      top: p.y + l.top,
      hx: l.hx,
      hz: l.shape === "cyl" ? l.hx : l.hz,
      rot: p.rot,
      tone: l.tone,
      solid: l.solid ?? true,
      standable: l.standable ?? false,
      sides: l.shape === "cyl" ? 10 : undefined,
      hidden: l.hidden,
    };
  });
}

/* ---------- placement ---------- */

export type Verdict = { ok: boolean; y: number; reason: string | null };

type Body = { x: number; y: number; z: number };

/* Points across the footprint (corners, edges, middle), in world space. */
function samples(kind: KitId, x: number, z: number, rot: number, step = 1) {
  const d = PREFABS[kind];
  const out: { x: number; z: number; lz: number }[] = [];
  const nx = Math.max(1, Math.ceil((d.hx * 2) / step));
  const nz = Math.max(1, Math.ceil((d.z1 - d.z0) / step));
  for (let i = 0; i <= nx; i++) {
    for (let j = 0; j <= nz; j++) {
      const lx = -d.hx + (i / nx) * d.hx * 2;
      const lz = d.z0 + (j / nz) * (d.z1 - d.z0);
      out.push({ ...toWorld(x, z, rot, lx, lz), lz });
    }
  }
  return out;
}

/* Does solid `s` reach into the footprint (grown by `pad`)? Exact for boxes and cylinders. */
function intrudes(s: Solid, kind: KitId, x: number, z: number, rot: number, pad: number) {
  const d = PREFABS[kind];
  const c = Math.cos(rot);
  const sn = Math.sin(rot);
  /* The footprint's centre and the solid's, in the footprint's local space. */
  const mid = (d.z0 + d.z1) / 2;
  const fx = x + mid * sn;
  const fz = z + mid * c;
  const hx = d.hx + pad;
  const hz = (d.z1 - d.z0) / 2 + pad;
  const dx = s.x - fx;
  const dz = s.z - fz;
  const lx = dx * c - dz * sn;
  const lz = dx * sn + dz * c;
  if (!s.box) {
    const cx = Math.max(-hx, Math.min(hx, lx));
    const cz = Math.max(-hz, Math.min(hz, lz));
    return (lx - cx) ** 2 + (lz - cz) ** 2 < s.r * s.r;
  }
  /* Two oriented rectangles: separated if any of the four edge normals splits them. */
  const b = s.box;
  /* The solid's local axes, expressed in the footprint's frame. */
  const ux = b.c * c + b.s * sn;
  const uz = b.c * sn - b.s * c;
  const vx = b.s * c - b.c * sn;
  const vz = b.s * sn + b.c * c;
  const axes: [number, number][] = [
    [1, 0],
    [0, 1],
    [ux, uz],
    [vx, vz],
  ];
  for (const [ax, az] of axes) {
    const ra = hx * Math.abs(ax) + hz * Math.abs(az);
    const rb = b.hx * Math.abs(ux * ax + uz * az) + b.hz * Math.abs(vx * ax + vz * az);
    if (Math.abs(lx * ax + lz * az) >= ra + rb) return false;
  }
  return true;
}

/*
 * Can `kind` go at (x, z), turned by `rot`, for someone standing at `body`?
 * Both the ghost preview and the room ask this, with the same answer.
 */
export function checkPlacement(
  terrain: Ground,
  kind: KitId,
  x: number,
  z: number,
  rot: number,
  body: Body,
): Verdict {
  const d = PREFABS[kind];
  const no = (reason: string, y = 0): Verdict => ({ ok: false, y, reason });
  if (Math.hypot(x - body.x, z - body.z) > BUILD_REACH) return no("Too far away");
  const pts = samples(kind, x, z, rot);

  let y: number;
  if (d.placing === "land") {
    /* Small things can sit on floors; buildings go on the ground. */
    const ref = Math.max(body.y, terrain.heightAt(x, z)) + 0.6;
    let lo = Number.POSITIVE_INFINITY;
    let hi = Number.NEGATIVE_INFINITY;
    for (const p of pts) {
      const h = d.onFloors ? terrain.groundAt(p.x, p.z, ref).ground : terrain.heightAt(p.x, p.z);
      lo = Math.min(lo, h);
      hi = Math.max(hi, h);
    }
    y = d.onFloors ? hi : hi - 0.05;
    if (lo < SEA_LEVEL + 0.35) return no("Too close to the water", y);
    if (hi - lo > d.spread) return no("The ground is too uneven", y);
    if (!d.onFloors && terrain.normalAt(x, z)[1] < 0.8) return no("Too steep here", y);
  } else if (d.placing === "shore") {
    y = DOCK_DECK;
    const start = terrain.heightAt(x, z);
    const end = terrain.heightAt(...xz(toWorld(x, z, rot, 0, d.z0 + 0.5)));
    if (start < SEA_LEVEL - 0.5 || start > DOCK_DECK + 0.6)
      return no("Start a dock at the water's edge", y);
    if (end > SEA_LEVEL - 1.2) return no("Point it out to sea", y);
    for (const p of pts) {
      if (p.lz < -2 && terrain.heightAt(p.x, p.z) > DOCK_DECK - 0.35)
        return no("The ground is in the way", y);
    }
  } else {
    y = SEA_LEVEL;
    for (const p of pts) {
      if (terrain.heightAt(p.x, p.z) > SEA_LEVEL - 0.6) return no("Needs deeper water", y);
    }
  }

  /* Nothing else in the way (the floor you're putting it on doesn't count). */
  const seen = new Set<Solid>();
  for (const p of pts) {
    for (const s of terrain.solidsNear(p.x, p.z)) {
      if (seen.has(s)) continue;
      seen.add(s);
      if (s.top <= y + 0.25 || s.bottom >= y + d.height) continue;
      if (intrudes(s, kind, x, z, rot, 0.05)) return no("Something's in the way", y);
    }
  }

  /* And not on top of you. */
  const me: Solid = {
    x: body.x,
    z: body.z,
    r: PLAYER_RADIUS + 0.15,
    bottom: 0,
    top: 0,
    standable: false,
  };
  if (body.y < y + d.height && body.y + 1.8 > y && intrudes(me, kind, x, z, rot, 0))
    return no("Stand clear", y);
  return { ok: true, y, reason: null };
}

const xz = (p: { x: number; z: number }): [number, number] => [p.x, p.z];

/* Is (x, z) over this prefab's footprint (grown by `pad`)? */
export function overPrefab(p: Prefab, x: number, z: number, pad = 0) {
  const d = PREFABS[p.kind];
  const c = Math.cos(p.rot);
  const s = Math.sin(p.rot);
  const dx = x - p.x;
  const dz = z - p.z;
  const lx = dx * c - dz * s;
  const lz = dx * s + dz * c;
  return Math.abs(lx) <= d.hx + pad && lz >= d.z0 - pad && lz <= d.z1 + pad;
}
