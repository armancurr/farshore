import { CAIRN_REACH } from "../shared/constants";
import { angleTo, type Rng, range } from "../shared/math";
import type { Body, Intent } from "../shared/physics";
import type { GroundWeapon, Held, Pillar } from "../shared/protocol";
import type { Spot, Terrain } from "../shared/terrain";
import { weaponDef } from "../shared/weapons";

export type Brain = {
  tx: number;
  ty: number;
  tz: number;
  /* Footholds up to the target (stairs, crates), and which one we're on. */
  route: readonly Spot[] | null;
  leg: number;
  cairn: number | null;
  /* The weapon on the ground we're heading for. */
  weapon: number | null;
  retargetAt: number;
  checkAt: number;
  lastX: number;
  lastZ: number;
  detourUntil: number;
  detourTurn: number;
  aggression: number;
  greed: number;
  nextSocial: number;
  stoneAt: number;
};

export type BotView = {
  terrain: Terrain;
  pillars: readonly Pillar[];
  tide: number;
  tideSoon: number;
  time: number;
  cairnsTaken: ReadonlySet<number>;
  weapons: readonly GroundWeapon[];
  others: { id: number; x: number; y: number; z: number; yaw: number }[];
};

export type BotAction = {
  intent: Intent;
  yaw: number;
  attack: boolean;
  /* Seconds a hammer or flail was wound up. */
  charge: number;
  stone: boolean;
};

type Self = { id: number; body: Body; stones: number; weapon: Held | null };

export function createBrain(rng: Rng): Brain {
  return {
    tx: 0,
    ty: 0,
    tz: 0,
    route: null,
    leg: 0,
    cairn: null,
    weapon: null,
    retargetAt: 0,
    checkAt: 0,
    lastX: 0,
    lastZ: 0,
    detourUntil: 0,
    detourTurn: 0,
    aggression: range(rng, 0.06, 0.3),
    greed: range(rng, 0.4, 1.4),
    nextSocial: 0,
    stoneAt: 0,
  };
}

function pickTarget(self: Self, brain: Brain, view: BotView, rng: Rng) {
  const b = self.body;
  let best = { x: view.terrain.lighthouse.x, y: view.terrain.peak, z: view.terrain.lighthouse.z };
  let bestScore = Number.NEGATIVE_INFINITY;
  let bestCairn: number | null = null;
  let bestRoute: readonly Spot[] | null = null;
  let bestWeapon: number | null = null;

  const crowd = (x: number, z: number) =>
    view.others.reduce((n, o) => n + (Math.hypot(o.x - x, o.z - z) < 4 ? 1 : 0), 0);

  const consider = (
    x: number,
    y: number,
    z: number,
    bonus: number,
    cairn: number | null,
    route: readonly Spot[] | null = null,
    weapon: number | null = null,
  ) => {
    if (y < view.tideSoon + 0.8) return;
    const dist = Math.hypot(x - b.x, z - b.z);
    const score = y - view.tideSoon - dist * 0.07 + rng() * 6 - crowd(x, z) * 2.2 + bonus;
    if (score > bestScore) {
      bestScore = score;
      best = { x, y, z };
      bestCairn = cairn;
      bestRoute = route;
      bestWeapon = weapon;
    }
  };

  for (const s of view.terrain.highSpots) consider(s.x, s.y, s.z, 0, null, s.route ?? null);
  for (const p of view.pillars) consider(p.x, p.top, p.z, 0, null);
  if (self.stones < 4 && view.time < 110) {
    for (const c of view.terrain.cairns) {
      if (view.cairnsTaken.has(c.id)) continue;
      const dist = Math.hypot(c.x - b.x, c.z - b.z);
      if (dist > 70) continue;
      consider(c.x, c.y, c.z, 14 * brain.greed - dist * 0.15, c.id);
    }
  }

  brain.tx = best.x;
  brain.ty = best.y;
  brain.tz = best.z;
  /* Empty-handed and the sea isn't pressing: go and arm yourself. */
  const safe = view.tideSoon < b.y - 3;
  if (!self.weapon && safe && rng() < 0.45 + brain.greed * 0.35) {
    let nearest: GroundWeapon | null = null;
    let nearestD = 80;
    for (const w of view.weapons) {
      const d = Math.hypot(w.x - b.x, w.z - b.z);
      if (d < nearestD && w.y > view.tideSoon + 2) {
        nearest = w;
        nearestD = d;
      }
    }
    if (nearest) {
      const w = nearest;
      const perch = view.terrain.highSpots.find(
        (s) => s.route && Math.hypot(s.x - w.x, s.z - w.z) < 0.5 && Math.abs(s.y - w.y) < 0.5,
      );
      best = { x: w.x, y: w.y, z: w.z };
      bestCairn = null;
      bestRoute = perch?.route ?? null;
      bestWeapon = w.id;
    }
  }

  brain.cairn = bestCairn;
  brain.weapon = bestWeapon;
  const route = bestRoute as readonly Spot[] | null;
  brain.route = route && route.length > 1 ? route : null;
  brain.leg = 0;
}

/* The point to walk at right now: the next foothold, or the target itself. */
function waypoint(b: Body, brain: Brain) {
  const route = brain.route;
  if (!route) return { x: brain.tx, y: brain.ty, z: brain.tz };
  /* Fell off the stairs: start the climb again from the bottom. */
  if (brain.leg > 0 && b.y < route[brain.leg - 1].y - 0.7 && !b.climbing) brain.leg = 0;
  while (brain.leg < route.length - 1) {
    const p = route[brain.leg];
    if (Math.hypot(p.x - b.x, p.z - b.z) < 0.85 && b.y > p.y - 0.35) brain.leg++;
    else break;
  }
  return route[brain.leg];
}

/* A bot decides once per tick: where to walk, whether to jump, shove or build. */
export function think(self: Self, brain: Brain, view: BotView, now: number, rng: Rng): BotAction {
  const b = self.body;
  const cairnGone =
    (brain.cairn !== null && view.cairnsTaken.has(brain.cairn)) ||
    (brain.weapon !== null && (!!self.weapon || !view.weapons.some((w) => w.id === brain.weapon)));
  const near = Math.hypot(brain.tx - b.x, brain.tz - b.z);
  /* Don't change your mind halfway up a staircase. */
  if (brain.route && brain.leg > 0 && brain.ty >= view.tideSoon + 0.4)
    brain.retargetAt = Math.max(brain.retargetAt, now + 1);
  if (
    now >= brain.retargetAt ||
    cairnGone ||
    brain.ty < view.tideSoon + 0.4 ||
    (brain.cairn !== null && near < CAIRN_REACH)
  ) {
    pickTarget(self, brain, view, rng);
    brain.retargetAt = now + range(rng, 5, 10);
  }

  const wp = waypoint(b, brain);
  const climbing = brain.route !== null && brain.leg > 0;
  const dx = wp.x - b.x;
  const dz = wp.z - b.z;
  const dist = Math.hypot(dx, dz);
  let yaw = angleTo(dx, dz);
  let jump = false;

  if (now >= brain.checkAt) {
    const moved = Math.hypot(b.x - brain.lastX, b.z - brain.lastZ);
    if (moved < 0.9 && dist > 2.2 && !climbing) {
      brain.detourUntil = now + range(rng, 0.8, 1.6);
      brain.detourTurn = (rng() < 0.5 ? -1 : 1) * range(rng, 0.9, 1.9);
      jump = true;
    }
    brain.lastX = b.x;
    brain.lastZ = b.z;
    brain.checkAt = now + 1;
  }
  if (now < brain.detourUntil && !climbing) yaw += brain.detourTurn;

  const wet = view.tide - b.y;
  const onLadder = b.climbing;
  /* Steps are walked; anything taller than a step gets a jump; ladders are climbed. */
  if (dist < 2.6 && wp.y > b.y + 0.6 && !wp.ladder && !onLadder) jump = true;
  if (wet > 0.3 && rng() < 0.06 && !onLadder) jump = true;
  /* A landing partway up a ladder: climb a little past it and push off onto it. */
  if (onLadder && !wp.ladder) jump = wp.y < b.y - 0.3;

  const urgent = view.tideSoon > b.y - 1.6;
  const lastLeg = !brain.route || brain.leg >= brain.route.length - 1;
  const intent: Intent = {
    forward: wp.ladder || onLadder || dist > (lastLeg ? 1.1 : 0.2) ? 1 : 0,
    right: 0,
    jump,
    sprint: !climbing && (urgent || dist > 35) && b.stamina > 28,
  };

  /* Fight whoever is in reach, more readily when armed. */
  let attack = false;
  let charge = 0;
  const def = weaponDef(self.weapon?.kind ?? null);
  if (now >= brain.nextSocial && !onLadder) {
    brain.nextSocial = now + range(rng, 0.25, 0.5);
    let closest: (typeof view.others)[number] | null = null;
    let closestD = def.reach * 0.9;
    for (const o of view.others) {
      const d = Math.hypot(o.x - b.x, o.z - b.z);
      if (d < closestD && Math.abs(o.y - b.y) < 1.6) {
        closest = o;
        closestD = d;
      }
    }
    if (closest) {
      const rival = closest.y >= b.y - 0.3;
      const armed = self.weapon ? 2.2 : 1;
      if (rng() < brain.aggression * armed * (rival ? 1 : 0.4)) {
        yaw = angleTo(closest.x - b.x, closest.z - b.z);
        attack = true;
        charge = def.charge ? range(rng, def.charge.min, def.charge.max) : 0;
      }
    }
  }

  let stone = false;
  if (self.stones > 0 && now >= brain.stoneAt) {
    const drowning = wet > -0.1;
    const holding = dist < 1.6 && view.tideSoon > b.y - 0.6;
    if ((drowning && rng() < 0.3) || (holding && rng() < 0.08)) {
      stone = true;
      brain.stoneAt = now + 2.5;
    }
  }

  return { intent, yaw, attack, charge, stone };
}
