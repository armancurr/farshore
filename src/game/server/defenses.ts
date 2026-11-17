import type { Archipelago } from "../shared/archipelago";
import { type PlacedItem } from "../shared/catalogue";
import { arcClear, DEFENSES, DRILLED, type DefenseSpec, muzzleOf } from "../shared/defenses";
import { distanceTo, type VehicleState, vehicleSolids } from "../shared/drive";
import { wrapAngle } from "../shared/math";
import { overItem } from "../shared/placing";
import { PLOT_SIZES } from "../shared/plots";
import { round2 } from "../shared/protocol";
import type { SavedPlot } from "../shared/save";
import { type Cloud, leadAt, SHOTS, smokeBlocks } from "../shared/shots";
import type { VehicleKind } from "../shared/vehicles";

/*
 * The defenses, as the room runs them. A plot's towers and engines only
 * wake while someone is raiding it (whether its owner is about or not):
 * then each picks the nearest raider it can reach and see (a gun for ships
 * picks the nearest ship with raiders aboard first), swings round to him,
 * leads him a little, and lets fly when it's on him and loaded. Smoke and
 * walls hide raiders from the archers and the guns; a lobbed stone only
 * needs to see over them. Rubble does nothing.
 */

/* Someone raiding, as a defense sees them: where, how fast, and which land. */
export type Foe = {
  id: number;
  x: number;
  y: number;
  z: number;
  vx: number;
  vz: number;
  raid: number | null;
  /* Sat in this vehicle. */
  ride: number | null;
};

/* A vehicle out there, and the plots anyone aboard is raiding. */
export type Ship = { id: number; kind: VehicleKind; state: VehicleState; raids: readonly number[] };

export interface DefenseHost {
  readonly world: Archipelago;
  readonly plots: ReadonlyMap<number, SavedPlot>;
  clouds(): readonly Cloud[];
  rng(): number;
  /* Let fly from `at` at `v`, a shot of this defense's. */
  fire(
    plot: SavedPlot,
    item: PlacedItem,
    spec: DefenseSpec,
    at: { x: number; y: number; z: number },
    v: { x: number; y: number; z: number },
  ): void;
}

type Point = { x: number; y: number; z: number };

/* One defense's own state: which way it's pointed (as an item's rot), when it's loaded, what at. */
type Aim = { yaw: number; pitch: number; readyAt: number; target: number | null; plot: number };

/* How near on (radians) a gun has to have swung before it fires. */
const ON_TARGET = 0.06;

export class Defenses {
  private aims = new Map<number, Aim>();

  constructor(private readonly host: DefenseHost) {}

  /* Every defense awake and aiming, flat, for the snapshot: [item id, heading, elevation] each. */
  snapshot(): number[] {
    const out: number[] = [];
    for (const [id, a] of this.aims) out.push(id, round2(a.yaw), round2(a.pitch));
    return out;
  }

  aimOf(id: number) {
    return this.aims.get(id) ?? null;
  }

  tick(now: number, dt: number, foes: readonly Foe[], ships: readonly Ship[]) {
    const awake = new Set<number>();
    for (const plot of this.host.plots.values()) {
      const raiders = foes.filter((f) => f.raid === plot.id);
      const boats = ships.filter((s) => s.raids.includes(plot.id));
      if (!raiders.length && !boats.length) continue;
      const drilled = plot.items.some((o) => o.kind === "archery" && o.hp > 0);
      for (const item of plot.items) {
        const spec = DEFENSES[item.kind];
        if (!spec || item.hp <= 0) continue;
        awake.add(item.id);
        this.work(plot, item, spec, raiders, boats, drilled, now, dt);
      }
    }
    for (const id of this.aims.keys()) if (!awake.has(id)) this.aims.delete(id);
  }

  /* One defense, one tick: a target, a swing toward it, and a shot when it's on him. */
  private work(
    plot: SavedPlot,
    item: PlacedItem,
    spec: DefenseSpec,
    raiders: readonly Foe[],
    boats: readonly Ship[],
    drilled: boolean,
    now: number,
    dt: number,
  ) {
    let aim = this.aims.get(item.id);
    if (!aim) {
      const readyAt = now + 1 + this.host.rng();
      aim = { yaw: item.rot, pitch: 0, readyAt, target: null, plot: plot.id };
      this.aims.set(item.id, aim);
    }
    const from = muzzleOf(item);
    const shot = this.pick(plot, item, spec, from, raiders, boats, now, aim.target);
    aim.target = shot?.id ?? null;
    if (!shot) return;
    const v = shot.v;
    const want = Math.atan2(v.x, v.z);
    const pitch = Math.atan2(v.y, Math.hypot(v.x, v.z));
    const off = wrapAngle(want - aim.yaw);
    const swing = spec.turn * dt;
    aim.yaw = Math.abs(off) <= swing ? want : wrapAngle(aim.yaw + Math.sign(off) * swing);
    aim.pitch += (pitch - aim.pitch) * Math.min(1, dt * 4);
    if (Math.abs(wrapAngle(want - aim.yaw)) > ON_TARGET || now < aim.readyAt) return;
    const archers = spec.archers !== undefined;
    aim.readyAt = now + spec.cooldown / (archers && drilled ? DRILLED : 1);
    /* Never quite true. */
    const sp = spec.spread;
    const speed = Math.hypot(v.x, v.y, v.z);
    const a = want + (this.host.rng() - 0.5) * 2 * sp;
    const e = pitch + (this.host.rng() - 0.5) * 2 * sp;
    this.host.fire(plot, item, spec, from, {
      x: Math.sin(a) * Math.cos(e) * speed,
      y: Math.sin(e) * speed,
      z: Math.cos(a) * Math.cos(e) * speed,
    });
  }

  /*
   * What to shoot at: a ship with raiders aboard (for a gun that takes on
   * ships), else the nearest raider, within reach, in sight (smoke hides
   * them), and with a clear flight to them. The one it's already on counts
   * as a little nearer.
   */
  private pick(
    plot: SavedPlot,
    item: PlacedItem,
    spec: DefenseSpec,
    from: Point,
    raiders: readonly Foe[],
    boats: readonly Ship[],
    now: number,
    was: number | null,
  ): { id: number; v: Point } | null {
    const clouds = this.host.clouds();
    const g = SHOTS[spec.shot].gravity;
    const own = (x: number, z: number) => overItem(item, x, z, 0.4);
    /* A shot at `at` (moving at `vel`): its velocity, if it can get there and be seen to. */
    const tryAt = (
      at: Point,
      vel: { x: number; z: number },
      near: (x: number, z: number) => boolean,
    ) => {
      if (smokeBlocks(clouds, from, at, now)) return null;
      const v = leadAt(from, at, vel, spec.speed, g, spec.lob);
      if (!v) return null;
      const f = { ...from, vx: v.x, vy: v.y, vz: v.z, gravity: g };
      const skip = (x: number, _y: number, z: number) => own(x, z) || near(x, z);
      return arcClear(this.host.world, f, at, { solid: !spec.lob, skip }) ? v : null;
    };
    const reach = (x: number, z: number, max: number) => {
      const d = Math.hypot(x - from.x, z - from.z);
      return d >= spec.min && d <= max ? d : null;
    };
    let best: { id: number; v: Point } | null = null;
    let bestD = Number.POSITIVE_INFINITY;
    if (spec.targets !== "people") {
      for (const s of boats) {
        const d = reach(s.state.x, s.state.z, spec.range);
        if (d === null) continue;
        const score = d - (s.id === was ? 5 : 0);
        if (score >= bestD) continue;
        const [hull] = vehicleSolids(s.kind, s.state);
        const at = { x: s.state.x, y: Math.min(hull.top, s.state.y + 2) - 0.3, z: s.state.z };
        const sp = s.state.speed;
        const vel = { x: -Math.sin(s.state.rot) * sp, z: -Math.cos(s.state.rot) * sp };
        const v = tryAt(at, vel, (x, z) => distanceTo(s.kind, s.state, x, z) < 1);
        if (!v) continue;
        best = { id: s.id, v };
        bestD = score;
      }
      if (best || spec.targets === "ships") return best;
    }
    const half = PLOT_SIZES[plot.size].size / 2 + 40;
    for (const f of raiders) {
      const d = reach(f.x, f.z, Math.min(spec.range, spec.people ?? spec.range));
      if (d === null || Math.abs(f.x - plot.x) > half || Math.abs(f.z - plot.z) > half) continue;
      const score = d - (f.id === was ? 3 : 0);
      if (score >= bestD) continue;
      const at = { x: f.x, y: f.y + 1.1, z: f.z };
      const v = tryAt(at, { x: f.vx, z: f.vz }, (x, z) => (x - f.x) ** 2 + (z - f.z) ** 2 < 1.2);
      if (!v) continue;
      best = { id: f.id, v };
      bestD = score;
    }
    return best;
  }
}
