import * as THREE from "three";
import { MODEL_BOUNDS, type ModelId } from "../../shared/models.gen";
import { type WeaponKind, weaponDef } from "../../shared/weapons";
import { PALETTE, shared } from "./materials";
import { packModel } from "./packs";

/*
 * The weapons, from the KayKit packs (public/models/weapons, gear and tools),
 * and the first-person view of whatever you're holding.
 *
 * Every weapon keeps the packs' hand-slot frame, so it drops straight onto a
 * KayKit hand bone: the grip at the origin, the blade or haft running up +Y,
 * and the cutting edge (or the knuckles, or a hammer's face) toward -X. A
 * shield's face looks down +Z. Each is scaled to true metres.
 */

type Spec = {
  id: ModelId;
  /* Adventurer gear has one atlas per adventurer; the rest use their pack's palette. */
  texture?: string;
  /* Metres per model unit. */
  scale: number;
  /* Where the hand closes, in model units up the grip, when it isn't the model's origin. */
  grip?: number;
};

const SPECS: Record<WeaponKind, Spec> = {
  /* A leaf-bladed fighting knife, one in each hand: 0.37 m. */
  daggers: { id: "weapons/dagger-a", scale: 0.29 },
  knuckles: { id: "weapons/fistweapon-a", scale: 0.36 },
  /* A curved, single-edged sailor's blade: 0.9 m. */
  cutlass: { id: "weapons/sword-c", scale: 0.42 },
  /* A long-bearded head on a short haft: 0.74 m. */
  beardaxe: { id: "weapons/axe-c", scale: 0.55 },
  /* The cooper's wooden mallet, from the tool bench: 0.6 m. */
  mallet: { id: "tools/mallet", scale: 0.62, grip: 0.05 },
  morningstar: { id: "weapons/hammer-b", scale: 0.5 },
  /* Polearms are gripped a third of the way up, where the leading hand goes: 2.2 m and 2.3 m. */
  spear: { id: "weapons/spear-a", scale: 0.7 },
  halberd: { id: "weapons/halberd", scale: 0.84 },
  /* A double-bitted axe, 1.1 m; a long-bladed greatsword, 1.55 m; a square-headed hammer, 1 m. */
  axe: { id: "weapons/axe-b", scale: 0.66 },
  greatsword: { id: "weapons/sword-e", scale: 0.48 },
  hammer: { id: "weapons/hammer-a", scale: 0.9 },
  /* Shields: a painted round one 0.6 m across, a kite 0.9 m tall, a studded tower with spikes. */
  shield: { id: "gear/shield-round-color", texture: "/models/gear/knight.png", scale: 0.68 },
  kite: { id: "weapons/shield-b", scale: 0.68 },
  spiked: { id: "weapons/shield-c", scale: 0.64 },
};

/* The model's bounds in metres, in the weapon's own frame (grip at the origin). */
function boundsOf(kind: WeaponKind) {
  const s = SPECS[kind];
  const b = MODEL_BOUNDS[s.id];
  const g = s.grip ?? 0;
  return {
    min: [b.min[0] * s.scale, (b.min[1] - g) * s.scale, b.min[2] * s.scale] as const,
    max: [b.max[0] * s.scale, (b.max[1] - g) * s.scale, b.max[2] * s.scale] as const,
  };
}

/*
 * Each weapon's model once it has loaded, to copy from. Copies share its
 * geometry and its pack's material, so they're never disposed one by one.
 */
const loaded = new Map<WeaponKind, THREE.Group>();
const loading = new Map<WeaponKind, Promise<THREE.Group>>();

function load(kind: WeaponKind) {
  let p = loading.get(kind);
  if (!p) {
    const s = SPECS[kind];
    p = packModel(s.id, s.texture).then((model) => {
      model.traverse((o) => {
        if ((o as THREE.Mesh).isMesh) o.userData.shared = true;
      });
      loaded.set(kind, model);
      return model;
    });
    loading.set(kind, p);
    p.catch(() => loading.delete(kind));
  }
  return p;
}

/*
 * A weapon, ready to hold. The group comes back at once, with the model in it
 * if it has loaded before, or dropped in as soon as it has.
 */
export function buildWeapon(kind: WeaponKind): THREE.Group {
  const s = SPECS[kind];
  const group = new THREE.Group();
  group.name = `weapon:${kind}`;
  const holder = new THREE.Group();
  holder.scale.setScalar(s.scale);
  holder.position.y = -(s.grip ?? 0) * s.scale;
  group.add(holder);
  const ready = loaded.get(kind);
  if (ready) holder.add(ready.clone(true));
  else void load(kind).then((model) => holder.add(model.clone(true)));
  return group;
}

/*
 * Resolves once every weapon given has loaded, atlas and all, so a still
 * picture of them isn't empty (or white).
 */
export async function weaponsReady(kinds: readonly WeaponKind[]) {
  const models = await Promise.all(kinds.map(load));
  const maps = new Set<THREE.Texture>();
  for (const m of models)
    m.traverse((o) => {
      const map = ((o as THREE.Mesh).material as THREE.MeshLambertMaterial | undefined)?.map;
      if (map) maps.add(map);
    });
  /* The atlases load on their own: wait (a few seconds at most) until each has its image. */
  for (let i = 0; i < 100 && [...maps].some((t) => !t.image); i++)
    await new Promise((r) => setTimeout(r, 50));
}

/* How long each weapon is, grip to tip (metres up its length), for framing it in a picture. */
export const WEAPON_SPAN = Object.fromEntries(
  (Object.keys(SPECS) as WeaponKind[]).map((k) => {
    const b = boundsOf(k);
    return [k, { from: b.min[1], to: b.max[1] }];
  }),
) as Record<WeaponKind, { from: number; to: number }>;

/* ---------- first person ---------- */

/*
 * A pose of one hand in front of the eye: where the grip is (metres, the view
 * looking down -Z) and how the weapon is turned (radians, applied X, Y, Z).
 * With no turn the weapon stands straight up, its edge facing forward.
 */
type Pose = readonly [number, number, number, number, number, number];

/*
 * One swing: wound back to `wind`, then whipped through `via` to `end` on a
 * curve, held a beat, and brought home. `tug` hauls it back toward you on the
 * way home (hooks); `reach` pushes it out (thrusts).
 */
type Move = {
  wind: Pose;
  via: Pose;
  end: Pose;
  /* Seconds for the strike itself and the way home. */
  strike: number;
  recover: number;
  tug?: number;
};

type Stance = {
  /* How big the model is drawn: weapons sit closer than arm's length, so they're shrunk. */
  scale: number;
  /*
   * How the model turns in the hand (radians about its haft) from edge-left:
   * blades lead with the edge (-π/2), heads show a little of their flat.
   */
  turn: number;
  rest: Pose;
  /* Swings in turn (forehand, backhand, …); `heavy` is the combo finisher. */
  moves: Move[];
  heavy?: Move;
  /* Charged weapons: where it's held at a full charge. */
  raised?: Pose;
  /* Shields: where it's held while blocking. */
  block?: Pose;
  /* A dual weapon also has one in the left hand, posed as the mirror of the right. */
  dual?: boolean;
  /* Shields go on the left arm. */
  left?: boolean;
};

const P = (x: number, y: number, z: number, rx = 0, ry = 0, rz = 0): Pose => [x, y, z, rx, ry, rz];

/* Down and across from up by the right shoulder. */
const forehand = (strike = 0.13, recover = 0.3): Move => ({
  wind: P(0.34, -0.04, -0.42, 0.15, -0.3, -0.75),
  via: P(0.12, -0.12, -0.62, -0.6, 0.05, 0.35),
  end: P(-0.24, -0.4, -0.5, -1.3, 0.3, 1.1),
  strike,
  recover,
});
/* And back the other way, from low on the left up and out to the right. */
const backhand: Move = {
  wind: P(-0.16, -0.16, -0.42, -0.1, 0.5, 1.05),
  via: P(0.06, -0.12, -0.62, -0.6, 0.05, 0.0),
  end: P(0.42, -0.3, -0.48, -1.15, -0.35, -1.1),
  strike: 0.13,
  recover: 0.3,
};
/*
 * Up over the shoulder and down through the target, a little across. A short
 * weapon stops higher (`low`), so its head stays in sight at the bottom.
 */
const overhead = (strike: number, recover: number, low = -0.46, tug = 0): Move => ({
  wind: P(0.26, 0.02, -0.44, 0.3, -0.2, -0.25),
  via: P(0.12, -0.1, -0.64, -0.6, -0.05, 0.12),
  end: P(0.04, low, -0.52, -1.45, 0.1, 0.35),
  strike,
  recover,
  tug,
});

const EDGE = -Math.PI / 2;

const STANCES: Record<WeaponKind, Stance> = {
  daggers: {
    scale: 0.95,
    turn: EDGE,
    dual: true,
    rest: P(0.22, -0.22, -0.42, -0.7, 0.05, 0.25),
    /* A jab: drawn back an inch, then driven at the crosshair, point first. */
    moves: [
      {
        wind: P(0.25, -0.26, -0.34, -0.85, 0.05, 0.2),
        via: P(0.13, -0.19, -0.58, -1.25, 0, 0.1),
        end: P(0.06, -0.16, -0.7, -1.45, 0, 0.05),
        strike: 0.07,
        recover: 0.16,
      },
    ],
  },
  knuckles: {
    scale: 1.2,
    turn: EDGE,
    dual: true,
    rest: P(0.19, -0.19, -0.42, 0.25, 0, -0.1),
    moves: [
      {
        wind: P(0.23, -0.25, -0.32, 0.3, 0.1, -0.2),
        via: P(0.11, -0.17, -0.56, 0.15, -0.1, 0.3),
        end: P(0.04, -0.13, -0.68, 0.1, -0.2, 0.6),
        strike: 0.07,
        recover: 0.18,
      },
    ],
    /* The haymaker: a wide hook from out on the right. */
    heavy: {
      wind: P(0.4, -0.2, -0.28, 0.2, 0.5, -0.4),
      via: P(0.2, -0.12, -0.62, 0.1, 0, 0.6),
      end: P(-0.16, -0.15, -0.56, 0.0, -0.6, 1.2),
      strike: 0.12,
      recover: 0.3,
    },
  },
  cutlass: {
    scale: 0.62,
    turn: -0.6,
    rest: P(0.3, -0.3, -0.46, -0.85, -0.1, 0.4),
    moves: [forehand(), backhand],
  },
  beardaxe: {
    scale: 0.55,
    turn: -0.2,
    rest: P(0.27, -0.3, -0.48, -0.5, -0.2, 0.4),
    /* Down through them, then a yank back on the beard. */
    moves: [overhead(0.13, 0.42, -0.28, 0.16)],
  },
  mallet: {
    scale: 0.62,
    turn: -0.6,
    rest: P(0.3, -0.32, -0.48, -0.45, -0.2, 0.35),
    moves: [forehand(0.15, 0.36)],
  },
  morningstar: {
    scale: 0.6,
    turn: -0.4,
    rest: P(0.3, -0.33, -0.48, -0.45, -0.1, 0.32),
    moves: [overhead(0.14, 0.4, -0.3)],
  },
  spear: {
    scale: 0.7,
    turn: EDGE,
    /* Couched low on the right, the point out ahead under the crosshair. */
    rest: P(0.17, -0.27, -0.22, -1.38, 0.03, 0.15),
    moves: [
      {
        wind: P(0.24, -0.31, 0.0, -1.32, 0.02, 0.16),
        via: P(0.15, -0.24, -0.55, -1.44, -0.02, 0.08),
        end: P(0.12, -0.22, -0.88, -1.48, -0.03, 0.05),
        strike: 0.1,
        recover: 0.34,
      },
    ],
  },
  halberd: {
    scale: 0.55,
    turn: -0.2,
    rest: P(0.26, -0.42, -0.36, -0.85, -0.1, 0.45),
    /* A sweep: swung out to the right, then right across the view. */
    moves: [
      {
        wind: P(0.4, -0.3, -0.42, -1.0, -0.9, -0.1),
        via: P(0.15, -0.3, -0.6, -1.2, 0.1, 0.8),
        end: P(-0.2, -0.36, -0.52, -1.1, 0.8, 1.2),
        strike: 0.2,
        recover: 0.5,
      },
    ],
  },
  axe: {
    scale: 0.45,
    turn: -0.15,
    rest: P(0.3, -0.38, -0.48, -0.45, -0.2, 0.55),
    moves: [overhead(0.17, 0.55)],
  },
  greatsword: {
    scale: 0.52,
    turn: -0.5,
    rest: P(0.28, -0.4, -0.44, -0.45, -0.05, 0.45),
    raised: P(0.26, -0.12, -0.5, 0.05, -0.1, -0.4),
    moves: [
      {
        wind: P(0.26, -0.12, -0.5, 0.05, -0.1, -0.4),
        via: P(0.12, -0.14, -0.62, -0.7, 0.0, 0.0),
        end: P(0.02, -0.46, -0.52, -1.4, 0.1, 0.3),
        strike: 0.16,
        recover: 0.55,
      },
    ],
  },
  hammer: {
    scale: 0.45,
    turn: -0.25,
    rest: P(0.29, -0.4, -0.48, -0.35, -0.25, 0.5),
    raised: P(0.26, -0.1, -0.56, 0.15, -0.2, -0.45),
    /* The slam: straight down in front of you. */
    moves: [
      {
        wind: P(0.26, -0.1, -0.56, 0.15, -0.2, -0.45),
        via: P(0.1, -0.18, -0.62, -0.8, -0.1, 0.05),
        end: P(0.05, -0.48, -0.58, -1.45, -0.05, 0.1),
        strike: 0.12,
        recover: 0.7,
      },
    ],
  },
  shield: shieldStance(0.62),
  kite: shieldStance(0.55),
  spiked: shieldStance(0.55),
};

/*
 * Held out on the left arm and raised square-on to block. You see its painted
 * face rather than its plain back: it's yours, and that's what you'd look at.
 */
function shieldStance(scale: number): Stance {
  return {
    scale,
    turn: 0,
    left: true,
    rest: P(-0.36, -0.3, -0.55, 0.05, 0.55, 0.08),
    block: P(-0.08, -0.17, -0.46, 0.0, 0.1, 0.0),
    /* The bash: punched straight out. */
    moves: [
      {
        wind: P(-0.2, -0.24, -0.4, 0.05, 0.35, 0.0),
        via: P(-0.12, -0.2, -0.66, 0.0, 0.12, 0.0),
        end: P(-0.1, -0.19, -0.8, -0.05, 0.08, 0.0),
        strike: 0.09,
        recover: 0.3,
      },
    ],
  };
}

const clamp01 = (t: number) => (t <= 0 ? 0 : t >= 1 ? 1 : t);
const smooth = (t: number) => {
  const u = clamp01(t);
  return u * u * (3 - 2 * u);
};
/* Fast out of the blocks and settling in: the strike. */
const whip = (t: number) => 1 - (1 - clamp01(t)) ** 3;
/* Back home, gently at both ends. */
const settle = (t: number) => {
  const u = clamp01(t);
  return u < 0.5 ? 4 * u * u * u : 1 - (-2 * u + 2) ** 3 / 2;
};

function mix(a: Pose, b: Pose, t: number): Pose {
  return [
    a[0] + (b[0] - a[0]) * t,
    a[1] + (b[1] - a[1]) * t,
    a[2] + (b[2] - a[2]) * t,
    a[3] + (b[3] - a[3]) * t,
    a[4] + (b[4] - a[4]) * t,
    a[5] + (b[5] - a[5]) * t,
  ];
}

/* A point on the curve from `a` through (near) `c` to `b`. */
function curve(a: Pose, c: Pose, b: Pose, t: number): Pose {
  const u = 1 - t;
  const out = [0, 0, 0, 0, 0, 0];
  for (let i = 0; i < 6; i++) out[i] = u * u * a[i] + 2 * u * t * c[i] + t * t * b[i];
  return out as unknown as Pose;
}

/* The left hand's pose for a right-hand one. */
const mirror = (p: Pose): Pose => [-p[0], p[1], p[2], p[3], -p[4], -p[5]];

type Swing = {
  move: Move;
  /* The pose it started from, so a swing never snaps. */
  from: Pose;
  at: number;
  wind: number;
  hand: 0 | 1;
};

/*
 * The weapon in your hands, drawn in its own little scene after the world so
 * it never clips into walls. It sits far above the sea (y = 1000) so the
 * shaders' below-the-waterline darkening never touches it. It has its own sun
 * and sky, turned with your view so it's lit as the world round it is.
 */
export type HeldModel = WeaponKind;

export class ViewModel {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(62, 1, 0.01, 20);
  private holder = new THREE.Group();
  /* The right hand and the left. */
  private hands = [new THREE.Group(), new THREE.Group()] as const;
  private shown: [Pose, Pose] = [P(0, -1, -0.5), P(0, -1, -0.5)];
  private kind: HeldModel | null = null;
  private stance: Stance | null = null;
  private swingState: Swing | null = null;
  private turn = 0;
  private equipAt = -10;
  private block = 0;
  private charge = 0;
  private sun = new THREE.DirectionalLight(0xffffff, 2.1);
  private sky = new THREE.HemisphereLight(0xd9d3ff, PALETTE.land, 1.25);
  /* A soft light from over your shoulder, so what you hold reads even facing into the sun. */
  private fill = new THREE.DirectionalLight(0xffffff, 1.1);
  /* Where you were looking last frame, for the weapon's lag behind a turn. */
  private look: { yaw: number; pitch: number } | null = null;
  private lag = { x: 0, y: 0, vx: 0, vy: 0 };
  /* A blow landing: a short shudder up the arm. */
  private jolt = 0;
  private clock = 0;

  constructor() {
    this.camera.position.set(0, 1000, 0);
    this.scene.add(this.camera, this.sky, this.sun, this.sun.target);
    this.fill.position.set(0.6, 0.8, 0.5);
    this.camera.add(this.holder, this.fill, this.fill.target);
    this.fill.target.position.set(0, -0.3, -0.5);
    this.holder.add(this.hands[0], this.hands[1]);
  }

  get visible() {
    return this.kind !== null;
  }

  set(kind: HeldModel | null) {
    if (kind === this.kind) return;
    this.kind = kind;
    this.stance = kind ? STANCES[kind] : null;
    this.swingState = null;
    for (const g of this.hands) {
      for (const c of [...g.children]) g.remove(c);
    }
    const st = this.stance;
    if (!kind || !st) return;
    const place = (hand: 0 | 1) => {
      const model = buildWeapon(kind);
      model.scale.setScalar(st.scale);
      model.rotation.y = st.turn;
      this.hands[hand].add(model);
    };
    if (st.left) place(1);
    else place(0);
    if (st.dual) place(1);
    this.equipAt = performance.now() / 1000;
    this.shown = [this.restOf(0), this.restOf(1)];
  }

  swing(heavy: boolean) {
    const st = this.stance;
    const kind = this.kind;
    if (!st || !kind) return;
    const def = weaponDef(kind);
    const hand: 0 | 1 = st.left ? 1 : st.dual ? (this.turn % 2 === 0 ? 0 : 1) : 0;
    const move = heavy && st.heavy ? st.heavy : st.moves[this.turn % st.moves.length];
    this.turn++;
    /*
     * The blow lands (on the server) `windup` seconds after the click, so the
     * wind-up takes most of that and the strike sweeps through as it lands.
     */
    const wind = st.raised ? 0.04 + 0.14 * (1 - this.charge) : Math.max(0.05, def.windup * 0.8);
    this.swingState = {
      move: hand === 1 ? mirrorMove(move) : move,
      from: this.shown[hand],
      at: performance.now() / 1000,
      wind,
      hand,
    };
  }

  /* Your blow landed (or one landed on your shield): a jolt up the arm. */
  impact(strength = 1) {
    this.jolt = Math.max(this.jolt, strength);
  }

  update(
    dt: number,
    o: {
      aspect: number;
      bob: number;
      bobAmp: number;
      charge: number | null;
      blocking: boolean;
      kick: number;
      /* Where you're looking (radians), so the light and the lag follow you round. */
      yaw?: number;
      pitch?: number;
    },
  ) {
    this.camera.aspect = o.aspect;
    this.camera.updateProjectionMatrix();
    const st = this.stance;
    if (!st) return;
    const now = performance.now() / 1000;
    this.clock += dt;

    /* The sun, as it falls on something in front of you looking this way. */
    if (o.yaw !== undefined && o.pitch !== undefined) {
      const view = new THREE.Euler(o.pitch, o.yaw, 0, "YXZ");
      const inv = new THREE.Quaternion().setFromEuler(view).invert();
      this.sun.position.copy(shared.uSun.value).applyQuaternion(inv).multiplyScalar(10);
      this.sun.position.add(this.camera.position);
      this.sun.target.position.copy(this.camera.position);
      this.sky.position.set(0, 1, 0).applyQuaternion(inv);
      this.lagBehind(dt, o.yaw, o.pitch);
    }

    this.block += ((o.blocking ? 1 : 0) - this.block) * Math.min(1, dt * 16);
    this.charge += ((o.charge ?? 0) - this.charge) * Math.min(1, dt * 18);
    if (o.charge === null && !this.swingState) this.charge *= 1 - Math.min(1, dt * 6);

    for (const hand of [0, 1] as const) {
      if (!this.hands[hand].children.length) continue;
      const pose = this.poseOf(hand, now);
      this.shown[hand] = pose;
      this.apply(hand, pose, o, now);
    }
    this.jolt = Math.max(0, this.jolt - dt * 5);
  }

  /* Where a hand rests, before anything else moves it. */
  private restOf(hand: 0 | 1): Pose {
    const st = this.stance as Stance;
    let rest = st.rest;
    if (st.raised && this.charge > 0) {
      rest = mix(rest, st.raised, smooth(this.charge));
      /* Held at the top, the arms start to shake with the weight of it. */
      const strain = smooth((this.charge - 0.85) / 0.15) * 0.006;
      if (strain > 0) {
        const t = this.clock * 40;
        rest = [
          rest[0] + Math.sin(t) * strain,
          rest[1] + Math.sin(t * 1.3 + 1) * strain,
          rest[2],
          rest[3] + Math.sin(t * 0.9 + 2) * strain * 3,
          rest[4],
          rest[5],
        ];
      }
    }
    if (st.block && this.block > 0) rest = mix(rest, st.block, smooth(this.block));
    return hand === 1 && !st.left ? mirror(rest) : rest;
  }

  private poseOf(hand: 0 | 1, now: number): Pose {
    const rest = this.restOf(hand);
    const s = this.swingState;
    if (!s || s.hand !== hand) {
      /* The idle hand of a pair draws back a touch while the other one strikes. */
      if (s && this.stance?.dual) {
        const t = now - s.at;
        const busy = Math.sin(clamp01(t / (s.wind + s.move.strike + s.move.recover)) * Math.PI);
        return mix(
          rest,
          [rest[0], rest[1] - 0.02, rest[2] + 0.06, rest[3] + 0.15, rest[4], rest[5]],
          busy,
        );
      }
      return rest;
    }
    const m = s.move;
    const t = now - s.at;
    const hold = 0.05;
    if (t < s.wind) return mix(s.from, m.wind, settle(t / s.wind));
    const u = t - s.wind;
    if (u < m.strike) return curve(m.wind, m.via, m.end, whip(u / m.strike));
    if (u < m.strike + hold) return m.end;
    const r = (u - m.strike - hold) / m.recover;
    if (r >= 1) {
      this.swingState = null;
      return rest;
    }
    const back = mix(m.end, rest, settle(r));
    if (!m.tug) return back;
    /* A hook hauls back toward you on the way home. */
    const tug = Math.sin(clamp01(r * 1.6) * Math.PI) * m.tug;
    return [back[0], back[1], back[2] + tug, back[3] + tug * 2, back[4], back[5]];
  }

  /* The pose, plus everything layered on it: breath, stride, lag, the draw, the kick. */
  private apply(
    hand: 0 | 1,
    p: Pose,
    o: { bob: number; bobAmp: number; kick: number },
    now: number,
  ) {
    const g = this.hands[hand];
    const side = hand === 0 ? 1 : -1;
    const heavy = this.stance ? 1 / Math.max(0.6, this.stance.scale) : 1;
    /* Breathing: a slow rise and fall, a little slower with heavy things. */
    const breath = Math.sin(this.clock * 1.6) * 0.006;
    /* Walking: the hands trace a figure of eight with each pair of steps. */
    const a = o.bobAmp;
    const stepX = Math.sin(o.bob * 0.5) * 0.018 * a * side;
    const stepY = -Math.abs(Math.cos(o.bob * 0.5)) * 0.022 * a;
    /* Drawing it: up from below, turning into place. */
    const draw = 1 - smooth((now - this.equipAt) / 0.4);
    const jolt = this.jolt * this.jolt;
    g.position.set(
      p[0] + stepX + this.lag.x * 0.04,
      p[1] + breath + stepY - draw * 0.45 + this.lag.y * 0.03 - jolt * 0.012,
      p[2] + jolt * 0.035 * heavy,
    );
    g.rotation.set(
      p[3] - draw * 0.9 + o.kick * 0.1 + jolt * 0.12 + this.lag.y * 0.08,
      p[4] - this.lag.x * 0.12,
      p[5] + draw * 0.4 * side + stepX * 1.5,
    );
  }

  /* The weapon trails a turn of the view a little, then springs back. */
  private lagBehind(dt: number, yaw: number, pitch: number) {
    const was = this.look;
    this.look = { yaw, pitch };
    if (!was || dt <= 0) return;
    let dy = yaw - was.yaw;
    if (dy > Math.PI) dy -= Math.PI * 2;
    if (dy < -Math.PI) dy += Math.PI * 2;
    const dp = pitch - was.pitch;
    const l = this.lag;
    /* A turn pushes the weapon the other way, up to a point; a spring brings it home. */
    l.vx += Math.max(-0.6, Math.min(0.6, dy)) * 18;
    l.vy += Math.max(-0.6, Math.min(0.6, -dp)) * 18;
    const k = 120;
    const damp = 2 * Math.sqrt(k) * 0.85;
    l.vx += (-k * l.x - damp * l.vx) * dt;
    l.vy += (-k * l.y - damp * l.vy) * dt;
    l.x = Math.max(-0.5, Math.min(0.5, l.x + l.vx * dt));
    l.y = Math.max(-0.5, Math.min(0.5, l.y + l.vy * dt));
  }

  dispose() {
    this.set(null);
  }
}

function mirrorMove(m: Move): Move {
  return { ...m, wind: mirror(m.wind), via: mirror(m.via), end: mirror(m.end) };
}
