import * as THREE from "three";
import { PLAYER_HEIGHT } from "../../shared/constants";
import { FLAG } from "../../shared/protocol";
import type { SkinId } from "../../shared/skins";
import { type Grip, gripOf, isThrown, type WeaponKind, weaponDef } from "../../shared/weapons";
import {
  buildCharacter,
  CHARACTER_SCALE,
  type Character,
  type ClipHalves,
  disposeCharacter,
  playerClips,
} from "./characters";
import { buildWeapon } from "./weapons";

/*
 * Another player, as you see them: their character, animated from what the
 * room says they're doing, what they hold, and their name over their head.
 *
 * The animation runs in two halves split at the waist. The legs always play
 * what the body is doing (standing, running, swimming); the arms and chest
 * play the same unless something takes them over (a swing, a raised shield,
 * a wind-up, a flinch), so a player can swing while running.
 */

/* Ground speed of the walk and run loops as KayKit made them, in metres per second at our scale. */
const WALK_PACE = 1.9;
const RUN_PACE = 5.6;
/* Seconds to blend from one clip to the next. */
const FADE = 0.12;

/* The swings, by how the weapon is held; a strike takes the next in turn. */
const ATTACKS: Record<Grip, readonly string[]> = {
  unarmed: ["Melee_Unarmed_Attack_Punch_A"],
  "1h": [
    "Melee_1H_Attack_Chop",
    "Melee_1H_Attack_Slice_Diagonal",
    "Melee_1H_Attack_Slice_Horizontal",
  ],
  "2h": ["Melee_2H_Attack_Chop", "Melee_2H_Attack_Slice"],
  dual: [
    "Melee_Dualwield_Attack_Chop",
    "Melee_Dualwield_Attack_Slice",
    "Melee_Dualwield_Attack_Stab",
  ],
  polearm: ["Melee_2H_Attack_Stab", "Melee_1H_Attack_Stab"],
  shield: ["Melee_Block_Attack"],
  bow: ["Ranged_Bow_Release"],
  crossbow: ["Ranged_2H_Shoot"],
};
/* A combo's finisher. */
const HEAVY: Record<Grip, string> = {
  unarmed: "Melee_Unarmed_Attack_Punch_A",
  "1h": "Melee_1H_Attack_Slice_Horizontal",
  "2h": "Melee_2H_Attack_Chop",
  dual: "Melee_Dualwield_Attack_Chop",
  polearm: "Melee_2H_Attack_Stab",
  shield: "Melee_Block_Attack",
  bow: "Ranged_Bow_Release",
  crossbow: "Ranged_2H_Shoot",
};
/* A bow is drawn with a clip of its own, and held at full draw. */
const DRAW = "Ranged_Bow_Draw";
/* What the arms do, carrying a bow or a crossbow, standing about. */
const CARRY: Partial<Record<Grip, string>> = {
  bow: "Ranged_Bow_Idle",
  crossbow: "Ranged_2H_Aiming",
};
/* How far into each swing the weapon is drawn back furthest: a charge holds there, then lets go. */
const WINDUP: Record<string, number> = {
  Melee_2H_Attack_Chop: 0.38,
  Melee_2H_Attack_Slice: 0.3,
  Melee_2H_Attack_Stab: 0.3,
  [DRAW]: 0.96,
};

/*
 * How the swimmer sits against where the room puts them. A swimmer's feet
 * hang FLOAT_DEPTH under the surface; the swim lies flat, so it's lifted to
 * put the back at the waterline (the treading clip sinks its own hips to
 * match). A rider is placed by riderPose (shared/drive.ts), already RIDER_HIP
 * under the seat, which is where the seated pose wants its origin.
 */
const SWIM_LIFT = 1.15;
const RIDE_DROP = 0;

/*
 * Turn a weapon (grip at its origin, blade up +y, in metres) into a hand
 * slot's frame. KayKit's slots are made for weapons built the same way, so
 * only the rig's scale needs taking back off.
 */
function holdInHand(weapon: THREE.Object3D, slot: THREE.Bone) {
  const holder = new THREE.Group();
  holder.scale.setScalar(1 / CHARACTER_SCALE);
  holder.add(weapon);
  slot.add(holder);
  return holder;
}

/*
 * A raider's name shows red to everyone, so the owner can tell who's come
 * for them; a crewman's is in his land's colours.
 */
function nameTexture(name: string, stagger = 0, raider = false, colour = "#fff") {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 96;
  const ctx = canvas.getContext("2d")!;
  ctx.font = '600 40px "Google Sans Code", ui-monospace, monospace';
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const text = stagger > 0 ? `${name}  ${stagger}%` : name;
  /* Just the name, no box: a soft shadow keeps it legible against bright sky. */
  ctx.shadowColor = "rgba(0,0,0,0.85)";
  ctx.shadowBlur = 8;
  ctx.fillStyle = raider ? "#ff5a4c" : colour;
  ctx.fillText(text, 256, 48, 500);
  if (raider) {
    /* A red bar under it, readable even when the name is too far off to read. */
    const w = Math.min(480, ctx.measureText(text).width + 24);
    ctx.fillRect(256 - w / 2, 76, w, 8);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

type Play = { loop?: boolean; rate?: number; at?: number; paused?: boolean; restart?: boolean };

/* One half of the body: the clip it's fading to, and the ones it's fading from. */
class Layer {
  current = "";
  private actions = new Map<string, THREE.AnimationAction>();

  constructor(
    private mixer: THREE.AnimationMixer,
    private clips: Map<string, ClipHalves>,
    private half: keyof ClipHalves,
  ) {}

  action(name: string) {
    let a = this.actions.get(name);
    if (!a) {
      const clip = this.clips.get(name)?.[this.half];
      if (!clip) return null;
      a = this.mixer.clipAction(clip);
      a.clampWhenFinished = true;
      a.weight = 0;
      this.actions.set(name, a);
    }
    return a;
  }

  play(name: string, opts: Play = {}) {
    const a = this.action(name);
    if (!a) return;
    const once = opts.loop === false;
    a.setLoop(once ? THREE.LoopOnce : THREE.LoopRepeat, Infinity);
    a.timeScale = opts.rate ?? 1;
    if (name !== this.current || !a.isScheduled() || opts.restart) {
      a.reset();
      a.play();
      if (opts.at !== undefined) a.time = opts.at;
    }
    /* A finished one-shot stays paused on its last frame. */
    if (!once || opts.paused !== undefined) a.paused = opts.paused ?? false;
    if (opts.at !== undefined && a.paused) a.time = opts.at;
    this.current = name;
  }

  /* Fade toward the current clip, keeping the weights summing to one so no rest pose bleeds in. */
  update(dt: number, fade: number) {
    const k = 1 - Math.exp(-dt / fade);
    let sum = 0;
    for (const [name, a] of this.actions) {
      if (!a.isScheduled()) continue;
      a.weight += ((name === this.current ? 1 : 0) - a.weight) * k;
      if (name !== this.current && a.weight < 0.01) {
        a.weight = 0;
        a.stop();
        continue;
      }
      sum += a.weight;
    }
    if (sum > 0) for (const a of this.actions.values()) if (a.isScheduled()) a.weight /= sum;
  }

  time(name: string) {
    return this.actions.get(name)?.time ?? 0;
  }

  setTime(name: string, t: number) {
    const a = this.actions.get(name);
    if (a) a.time = t;
  }
}

/* Something the arms do over whatever the legs are doing. */
type Overlay = { clip: string; until: number };

export class Avatar {
  readonly group = new THREE.Group();
  /* Holds the character: lifted when swimming, sunk onto a seat when riding. */
  private body = new THREE.Group();
  private char: Character | null = null;
  private mixer: THREE.AnimationMixer | null = null;
  private lower: Layer | null = null;
  private upper: Layer | null = null;
  private clips: Map<string, ClipHalves> | null = null;
  /* Bumped on every skin change, so a slow load for an old skin is thrown away. */
  private loading = 0;
  private label: THREE.Sprite;
  private clock = 0;
  private last = new THREE.Vector3();
  private placed = false;
  /* Smoothed ground velocity in the body's frame: forward and to the right, m/s. */
  private fwd = 0;
  private side = 0;
  private vy = 0;
  private airborne = 0;
  private flags: number = FLAG.alive | FLAG.grounded;
  private pitch = 0;
  private weapon: WeaponKind | null = null;
  private held: THREE.Object3D[] = [];
  private stagger = 0;
  private swing: Overlay | null = null;
  private flinch: Overlay | null = null;
  private swings = 0;
  /* Whether the name floats over them: not over yourself, seen from behind. */
  labelled = true;
  private raider = false;
  private colour = "#fff";
  /* Within this many metres of the camera the name fades out. */
  private nearFade = 2.5;

  constructor(
    readonly id: number,
    private name: string,
    private skin: SkinId,
  ) {
    this.group.add(this.body);
    this.label = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: nameTexture(name),
        transparent: true,
        depthWrite: false,
        fog: false,
      }),
    );
    this.label.scale.set(1.7, 0.32, 1);
    this.label.position.y = PLAYER_HEIGHT + 0.3;
    this.label.renderOrder = 5;
    this.group.add(this.label);
    /* Start mid-way through idle motions so a crowd doesn't move in step. */
    this.clock = (id * 0.37) % 5;
    void this.load();
  }

  private async load() {
    const ticket = ++this.loading;
    const [char, clips] = await Promise.all([buildCharacter(this.skin), playerClips()]);
    if (ticket !== this.loading || this.loading < 0) {
      disposeCharacter(char);
      return;
    }
    this.unload();
    this.char = char;
    this.clips = clips;
    this.mixer = new THREE.AnimationMixer(char.model);
    this.lower = new Layer(this.mixer, clips, "lower");
    this.upper = new Layer(this.mixer, clips, "upper");
    this.body.add(char.root);
    this.arm();
    /* Into the right pose at once, not a blend out of the bind pose. */
    this.animate(0);
    this.lower.update(1, FADE);
    this.upper.update(1, FADE);
    this.mixer.update(this.clock % 1);
    this.lookUp();
  }

  private unload() {
    for (const h of this.held) h.removeFromParent();
    this.held = [];
    if (this.mixer) {
      this.mixer.stopAllAction();
      if (this.char) this.mixer.uncacheRoot(this.char.model);
    }
    if (this.char) disposeCharacter(this.char);
    this.char = null;
    this.mixer = null;
    this.lower = null;
    this.upper = null;
  }

  /* Change what they look like, keeping whatever they hold. */
  setSkin(skin: SkinId) {
    if (skin === this.skin) return;
    this.skin = skin;
    void this.load();
  }

  /* Put the weapon in their hands: the main hand, and the off hand for a pair or a shield. */
  private arm() {
    for (const h of this.held) h.removeFromParent();
    this.held = [];
    const c = this.char;
    const kind = this.weapon;
    if (!c || !kind) return;
    const grip = gripOf(kind);
    const hands =
      grip === "shield" || grip === "bow"
        ? [c.bones.handL]
        : grip === "dual"
          ? [c.bones.handR, c.bones.handL]
          : [c.bones.handR];
    for (const hand of hands) {
      /* buildWeapon already puts the grip where the hand goes, polearms included. */
      const model = buildWeapon(kind);
      model.traverse((o) => {
        if ((o as THREE.Mesh).isMesh) o.castShadow = true;
      });
      this.held.push(holdInHand(model, hand));
    }
  }

  /* Show what they're holding and how battered they are. */
  setGear(weapon: WeaponKind | null, stagger: number) {
    if (weapon !== this.weapon) {
      this.weapon = weapon;
      this.arm();
    }
    const s = Math.round(stagger / 5) * 5;
    if (s !== this.stagger) {
      this.stagger = s;
      this.relabel();
    }
  }

  /* Raiding someone's land: the name goes red. */
  setRaider(raider: boolean) {
    if (raider === this.raider) return;
    this.raider = raider;
    this.relabel();
  }

  /* What's written over their head, and in what colour (a crewman's: his land's). */
  setTag(name: string, colour: string) {
    if (name === this.name && colour === this.colour) return;
    this.name = name;
    this.colour = colour;
    /* A longer tag ("Bram · Arman's crew") is drawn a little larger, so it isn't squeezed small. */
    const k = name.length > 14 ? 1.25 : 1;
    /* Crews crowd round: their names give way to the men themselves up close. */
    this.nearFade = 5;
    this.label.scale.set(1.7 * k, 0.32 * k, 1);
    this.relabel();
  }

  private relabel() {
    const mat = this.label.material;
    mat.map?.dispose();
    mat.map = nameTexture(this.name, this.stagger, this.raider, this.colour);
    mat.needsUpdate = true;
  }

  /* A swing seen from outside: the next in turn for what they hold, or the finisher. */
  strike(heavy = false) {
    const grip = gripOf(this.weapon);
    const list = ATTACKS[grip];
    const clip = isThrown(this.weapon)
      ? "Throw"
      : heavy
        ? HEAVY[grip]
        : list[this.swings++ % list.length];
    const half = this.clips?.get(clip);
    if (!half || !this.upper) return;
    /* As long as the clip, squeezed to fit the weapon's pace (a dagger flicks, a hammer heaves). */
    const pace = Math.min(
      half.upper.duration,
      Math.max(0.5, weaponDef(this.weapon).cooldown * 1.1),
    );
    const rate = half.upper.duration / pace;
    /* Out of a wind-up, the swing picks up from the top of it (a bow's loose starts at once). */
    const charged = (this.flags & FLAG.charge) !== 0 && this.upper.current === clip;
    const at = charged ? (WINDUP[clip] ?? 0) * half.upper.duration : 0;
    this.upper.play(clip, { loop: false, rate, restart: true, at });
    this.swing = { clip, until: this.clock + (half.upper.duration - at) / rate - FADE };
  }

  /* Caught by a blow: a flinch, unless they're mid-swing. */
  hurt() {
    if (this.swing || !this.upper) return;
    const clip = this.swings % 2 ? "Hit_A" : "Hit_B";
    const half = this.clips?.get(clip);
    if (!half) return;
    this.upper.play(clip, { loop: false, rate: 1.3, restart: true });
    this.flinch = { clip, until: this.clock + half.upper.duration / 1.3 - FADE };
  }

  setPose(
    x: number,
    y: number,
    z: number,
    yaw: number,
    pitch: number,
    flags: number,
    dt: number,
    camera: THREE.Vector3,
  ) {
    /* Velocity from how far they moved, turned into their own frame and smoothed over the snapshots' jitter. */
    if (!this.placed) this.last.set(x, y, z);
    this.placed = true;
    const k = dt > 0 ? 1 - Math.exp(-dt / 0.12) : 0;
    const vx = dt > 0 ? (x - this.last.x) / dt : 0;
    const vz = dt > 0 ? (z - this.last.z) / dt : 0;
    const vy = dt > 0 ? (y - this.last.y) / dt : 0;
    const s = Math.sin(yaw);
    const c = Math.cos(yaw);
    this.fwd += (Math.max(-15, Math.min(15, -vx * s - vz * c)) - this.fwd) * k;
    this.side += (Math.max(-15, Math.min(15, vx * c - vz * s)) - this.side) * k;
    this.vy += (vy - this.vy) * k;
    this.last.set(x, y, z);
    this.flags = flags;
    this.pitch = pitch;
    this.clock += dt;

    this.group.position.set(x, y, z);
    this.group.rotation.y = yaw;
    this.animate(dt);
    if (this.mixer) {
      this.mixer.update(dt);
      this.lookUp();
    }

    const d = camera.distanceTo(this.group.position);
    const mat = this.label.material;
    /* A raider's name carries much further: you want to see them coming. */
    const far = this.raider ? 160 : 60;
    mat.opacity = Math.max(0, Math.min(1, (far - d) / 25, (d - this.nearFade) / 2));
    this.label.visible = this.labelled && mat.opacity > 0.02;
  }

  /*
   * Choose what each half plays from the room's flags and how they're
   * moving, then let the layers blend toward it.
   */
  private animate(dt: number) {
    const lower = this.lower;
    const upper = this.upper;
    if (!lower || !upper) return;
    const f = this.flags;
    const alive = (f & FLAG.alive) !== 0;
    const grounded = (f & FLAG.grounded) !== 0;
    const riding = (f & FLAG.riding) !== 0;
    const swimming = (f & FLAG.wet) !== 0 && !grounded;
    const flying = (f & FLAG.fly) !== 0;
    this.airborne = grounded || swimming || flying || riding ? 0 : this.airborne + dt;
    const speed = Math.hypot(this.fwd, this.side);
    const grip = gripOf(this.weapon);

    /* The body: one clip for both halves, unless the legs are just walking about. */
    let clip = "Idle_A";
    let rate = 1;
    let loop = true;
    let lift = 0;
    let free = true; // whether the arms may do something else
    if (!alive) {
      clip = "Death_A";
      loop = false;
      free = false;
    } else if (riding) {
      clip = "Driving";
      lift = RIDE_DROP;
      free = false;
    } else if (flying) {
      clip = speed > 3 ? "Swim_Forward" : "Swim_Idle";
      rate = speed > 3 ? 0.6 : 0.8;
      free = false;
    } else if (swimming) {
      clip = speed > 0.6 ? "Swim_Forward" : "Swim_Idle";
      rate = speed > 0.6 ? Math.min(1.5, Math.max(0.7, speed / 2.5)) : 1;
      lift = SWIM_LIFT;
      free = false;
    } else if (this.airborne > 0.12) {
      clip = this.vy > 1.5 && this.airborne < 0.5 ? "Jump_Start" : "Jump_Idle";
      loop = clip === "Jump_Idle";
    } else if (speed > 0.6) {
      if (this.fwd < -0.5 * speed) {
        clip = "Walking_Backwards";
        rate = speed / WALK_PACE;
      } else if (Math.abs(this.side) > 0.75 * speed) {
        clip = this.side > 0 ? "Running_Strafe_Right" : "Running_Strafe_Left";
        rate = speed / RUN_PACE;
      } else if (speed < 3.6 && (f & FLAG.sprint) === 0) {
        clip = "Walking_A";
        rate = speed / WALK_PACE;
      } else {
        clip = "Running_A";
        rate = speed / RUN_PACE;
      }
      rate = Math.min(1.8, Math.max(0.6, rate));
    } else if (grip === "2h" || grip === "polearm") {
      clip = "Melee_2H_Idle";
    } else if (grip !== "unarmed") {
      clip = "Idle_A";
    }
    lower.play(clip, { loop, rate });
    this.body.position.y += (lift - this.body.position.y) * Math.min(1, dt * 8 || 1);

    /* The arms: a swing or a flinch plays out; a raised shield or a wind-up holds. */
    if (this.swing && (this.clock > this.swing.until || !free)) this.swing = null;
    if (this.flinch && (this.clock > this.flinch.until || !free)) this.flinch = null;
    if (!free) {
      upper.play(clip, { loop, rate });
    } else if (this.swing) {
      /* Already playing: it was started by strike(). */
    } else if (f & FLAG.charge) {
      const wind =
        grip === "bow"
          ? DRAW
          : (ATTACKS[grip].find((a) => WINDUP[a] !== undefined) ?? ATTACKS[grip][0]);
      const half = this.clips?.get(wind);
      const at = (WINDUP[wind] ?? 0.25) * (half?.upper.duration ?? 1);
      /* Draw it back, then hold. */
      const drawn = upper.current === wind && upper.time(wind) >= at;
      upper.play(wind, { loop: false, rate: 1.4, paused: drawn, at: drawn ? at : undefined });
    } else if (f & FLAG.block) {
      upper.play("Melee_Blocking");
    } else if (this.flinch) {
      /* Playing out. */
    } else {
      /* Carrying something big: both hands on it, unless running. */
      const carry = (grip === "2h" || grip === "polearm") && clip !== "Running_A";
      const ranged = CARRY[grip];
      const arms =
        ranged && clip !== "Running_A" && this.clips?.has(ranged)
          ? ranged
          : carry && lower.current !== "Jump_Idle"
            ? "Melee_2H_Idle"
            : clip;
      upper.play(arms, { loop: true, rate: arms === clip ? rate : 1 });
      /* Arms in step with the legs. */
      if (arms === clip) upper.setTime(clip, lower.time(clip));
    }
    const fade = alive ? FADE : 0.25;
    lower.update(dt, fade);
    upper.update(dt, fade);
  }

  /* The head (and a little of the chest) follow where they're looking. */
  private lookUp() {
    const c = this.char;
    if (!c || (this.flags & FLAG.alive) === 0) return;
    const p = Math.max(-1.2, Math.min(1.2, this.pitch));
    c.bones.chest.rotateX(-p * 0.25);
    c.bones.head.rotateX(-p * 0.5);
  }

  dispose() {
    this.loading = -1;
    this.unload();
    this.label.material.map?.dispose();
    this.label.material.dispose();
  }
}
