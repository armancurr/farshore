import type { ShotKind } from "./shots";

/*
 * Weapons, chosen from the marketplace. You carry one at a time. Most are for
 * close quarters; the bows, the crossbow, the wand and the mage's staff loose
 * arrows and bolts that really fly (see shots.ts). Beside your weapon you can
 * carry a stack of kegs or smoke bombs to throw, bought one by one. A hit
 * takes health (in survival, and off the Harbor) and adds stagger; stagger
 * multiplies knockback, so a battered fighter flies further.
 */

/*
 * The weapons added from the rest of KayKit's Fantasy Weapons Bits keep the
 * pack's own names ("sword-a" is its sword_A).
 */
export type WeaponKind =
  | "daggers"
  | "dagger-b"
  | "knuckles"
  | "fistweapon-b"
  | "cutlass"
  | "sword-a"
  | "sword-b"
  | "axe-a"
  | "beardaxe"
  | "mallet"
  | "hammer-c"
  | "morningstar"
  | "spear"
  | "halberd"
  | "staff-a"
  | "axe"
  | "sword-d"
  | "greatsword"
  | "hammer"
  | "bow-a"
  | "bow-b"
  | "crossbow"
  | "firebow"
  | "wand-a"
  | "staff-b"
  | "shield"
  | "shield-a"
  | "kite"
  | "spiked"
  | "torch"
  | "bucket"
  | "keg"
  | "smokebomb";

/*
 * In marketplace order: quick and light first, then the long reach, then the
 * heavy hitters, then what shoots, then the shields, then the raider's and
 * the firefighter's tools, then what you throw. The snapshot sends a weapon
 * as its place in this list, so client and server must share it (they do:
 * it lives here).
 */
export const WEAPON_KINDS: readonly WeaponKind[] = [
  "daggers",
  "dagger-b",
  "knuckles",
  "fistweapon-b",
  "cutlass",
  "sword-a",
  "sword-b",
  "axe-a",
  "beardaxe",
  "mallet",
  "hammer-c",
  "morningstar",
  "spear",
  "halberd",
  "staff-a",
  "axe",
  "sword-d",
  "greatsword",
  "hammer",
  "bow-a",
  "bow-b",
  "crossbow",
  "firebow",
  "wand-a",
  "staff-b",
  "shield",
  "shield-a",
  "kite",
  "spiked",
  "torch",
  "bucket",
  "keg",
  "smokebomb",
];

export const isWeaponKind = (v: unknown): v is WeaponKind =>
  typeof v === "string" && (WEAPON_KINDS as readonly string[]).includes(v);

/*
 * Weapons that were retired when the armory moved to real models, and what
 * each became: the nearest thing still on the shelf, so nobody's save or
 * remembered choice loses a weapon.
 */
const RETIRED: Record<string, WeaponKind> = {
  sickle: "cutlass",
  machete: "cutlass",
  boardaxe: "beardaxe",
  trident: "spear",
  mace: "morningstar",
  /* The plain longbow, from before the pack's bows came in. */
  bow: "bow-a",
};

/* A weapon kind from a save, a message or storage: today's kinds as they are, retired ones as their heirs. */
export function toWeaponKind(v: unknown): WeaponKind | null {
  if (isWeaponKind(v)) return v;
  return typeof v === "string" && Object.hasOwn(RETIRED, v) ? RETIRED[v] : null;
}

/*
 * How a shield holds a blow. `cover` is how far round it guards (the cosine of
 * the angle off straight ahead it still catches), `leak` the share of a blow
 * that gets through anyway, `parry` how soon after raising it a block parries.
 * `firm` holds even against weapons that sunder; `thorns` hurts whoever hits it.
 */
export type Guard = { cover: number; leak: number; parry: number; firm?: boolean; thorns?: number };

/*
 * Something that shoots: what it looses (see shots.ts), how fast it leaves
 * and what it does to a person, from the least draw (or gathering of a
 * bolt) to a full one (a crossbow or a wand has no draw: always the most).
 * `spread` is how far off true it flies (radians). Its `reach` is roughly
 * how far it carries, for the marketplace to say.
 */
export type Ranged = {
  shot: ShotKind;
  speed: readonly [number, number];
  damage: readonly [number, number];
  spread: number;
};

export type WeaponDef = {
  name: string;
  /* What it will cost once the marketplace takes coins. */
  price: number;
  /* Health taken by a plain hit. */
  damage: number;
  reach: number;
  /* Cosine of the half-angle of the strike; -1 hits all the way round. */
  arc: number;
  /* Seconds from the swing to the moment it lands. */
  windup: number;
  cooldown: number;
  /* Stagger % added, and the push at 0% (m/s, horizontal and up). */
  stagger: number;
  knock: number;
  lift: number;
  /* How it sounds and swings: a quick whistle, a steady cut, or a heavy whoosh. */
  heft: "quick" | "steady" | "heavy";
  /* A head that thuds rather than rings. */
  blunt?: boolean;
  /* Hold to charge, release to strike: seconds for a minimum and a full charge. */
  charge?: { min: number; max: number };
  /* Charged weapons: the damage at a full charge (a minimum charge does `damage`). */
  charged?: number;
  /* Move speed while carrying it. */
  speed?: number;
  /* Damage times this from behind. */
  backstab?: number;
  /* Damage times this against someone wading or swimming. */
  wet?: number;
  /* Hooks the target toward you at this speed, instead of knocking them away. */
  pull?: number;
  /* Extra damage, a little at a time over BLEED_TIME. */
  bleed?: number;
  /* Seconds the target is slowed to DAZE_SPEED. */
  daze?: number;
  /* Every third swing in quick succession hits for this. */
  combo?: number;
  /* Cuts through a raised shield for half its damage. */
  sunders?: boolean;
  /* Shields: right-click to raise it. */
  guard?: Guard;
  /*
   * Against buildings: the share of its damage a blow does to something
   * built (before the material's own resistance). Hammers and axes bring
   * walls down; a dagger barely scratches them.
   */
  siege: number;
  /* A torch: a blow on anything wooden sets it alight. */
  ignites?: boolean;
  /* A bucket: a swing at something burning throws water on it, while it holds any. */
  douses?: boolean;
  /* Shoots instead of swinging: hold to draw (with `charge`), release to loose. */
  ranged?: Ranged;
  /*
   * Thrown, and gone: bought one at a time and carried on the belt beside
   * your weapon, a stack of up to STACK. A click lobs one, at this speed.
   */
  throws?: { shot: ShotKind; speed: number };
  hint: string;
};

/* The most of one thing to throw you can carry. */
export const STACK = 5;

/* Ranged weapons and things to throw have no blow of their own: these fill in the melee fields. */
const NO_BLOW = {
  reach: 0,
  arc: 1,
  windup: 0,
  stagger: 0,
  knock: 0,
  lift: 0,
  siege: 0,
} as const;

export const FISTS: WeaponDef = {
  name: "Fists",
  price: 0,
  damage: 5,
  reach: 2.9,
  arc: 0.35,
  windup: 0.06,
  cooldown: 1.1,
  stagger: 6,
  knock: 9.5,
  lift: 4.5,
  heft: "steady",
  blunt: true,
  siege: 0.12,
  hint: "Click to shove",
};

export const WEAPONS: Record<WeaponKind, WeaponDef> = {
  /* Light and quick: little each, but it adds up, and each has its trick. */
  daggers: {
    name: "Twin daggers",
    price: 120,
    damage: 6,
    backstab: 2.5,
    reach: 1.9,
    arc: 0.6,
    windup: 0.05,
    cooldown: 0.22,
    stagger: 5,
    knock: 1.5,
    lift: 0.6,
    heft: "quick",
    siege: 0.02,
    hint: "Click to jab, left and right · far deadlier from behind",
  },
  knuckles: {
    name: "Knuckledusters",
    price: 100,
    damage: 5,
    combo: 16,
    speed: 1.08,
    reach: 1.8,
    arc: 0.55,
    windup: 0.04,
    cooldown: 0.26,
    stagger: 7,
    knock: 4,
    lift: 1.5,
    heft: "quick",
    blunt: true,
    siege: 0.03,
    hint: "Click to punch · every third blow in a row is a haymaker · light on your feet",
  },
  cutlass: {
    name: "Cutlass",
    price: 150,
    damage: 10,
    bleed: 6,
    reach: 2.5,
    arc: 0.55,
    windup: 0.09,
    cooldown: 0.38,
    stagger: 7,
    knock: 4,
    lift: 1.8,
    heft: "quick",
    siege: 0.14,
    hint: "Click to slash · draws blood that keeps flowing",
  },
  beardaxe: {
    name: "Bearded axe",
    price: 180,
    damage: 13,
    pull: 7,
    reach: 2.6,
    arc: 0.6,
    windup: 0.2,
    cooldown: 0.7,
    stagger: 10,
    knock: 0,
    lift: 2.5,
    heft: "steady",
    siege: 0.8,
    hint: "Click to hook · the bearded blade drags them to you",
  },
  mallet: {
    name: "Mallet",
    price: 130,
    damage: 4,
    reach: 2.5,
    arc: 0.55,
    windup: 0.22,
    cooldown: 0.9,
    stagger: 30,
    knock: 17,
    lift: 7,
    heft: "steady",
    blunt: true,
    siege: 5.5,
    hint: "Click to bonk · barely bruises, but sends them flying",
  },
  morningstar: {
    name: "Morning star",
    price: 200,
    damage: 18,
    daze: 1.5,
    reach: 2.4,
    arc: 0.6,
    windup: 0.28,
    cooldown: 0.95,
    stagger: 18,
    knock: 8,
    lift: 3.5,
    heft: "heavy",
    blunt: true,
    siege: 0.7,
    hint: "Click to bludgeon · leaves them dazed and slow",
  },
  "dagger-b": {
    name: "Dagger B",
    price: 110,
    damage: 8,
    backstab: 3,
    speed: 1.05,
    reach: 2,
    arc: 0.6,
    windup: 0.06,
    cooldown: 0.3,
    stagger: 5,
    knock: 2,
    lift: 0.8,
    heft: "quick",
    siege: 0.02,
    hint: "Click to stab · one blade, light on your feet, cruel from behind",
  },
  "fistweapon-b": {
    name: "Fistweapon B",
    price: 130,
    damage: 6,
    bleed: 3,
    combo: 14,
    reach: 2,
    arc: 0.55,
    windup: 0.05,
    cooldown: 0.28,
    stagger: 6,
    knock: 3,
    lift: 1.2,
    heft: "quick",
    siege: 0.03,
    hint: "Click to claw · draws blood · every third blow in a row tears deep",
  },
  "sword-a": {
    name: "Sword A",
    price: 140,
    damage: 11,
    reach: 2.6,
    arc: 0.55,
    windup: 0.1,
    cooldown: 0.45,
    stagger: 8,
    knock: 5,
    lift: 2,
    heft: "quick",
    siege: 0.14,
    hint: "Click to slash · a plain, quick blade",
  },
  "sword-b": {
    name: "Sword B",
    price: 160,
    damage: 13,
    reach: 2.6,
    arc: 0.55,
    windup: 0.12,
    cooldown: 0.55,
    stagger: 9,
    knock: 8,
    lift: 2.4,
    heft: "steady",
    siege: 0.16,
    hint: "Click to slash · a heavier blade that shoves them back",
  },
  "axe-a": {
    name: "Axe A",
    price: 150,
    damage: 12,
    reach: 2.4,
    arc: 0.6,
    windup: 0.16,
    cooldown: 0.6,
    stagger: 10,
    knock: 6,
    lift: 2.5,
    heft: "steady",
    siege: 0.9,
    hint: "Click to chop · a hand axe, quick to swing again",
  },
  "hammer-c": {
    name: "Hammer C",
    price: 170,
    damage: 14,
    daze: 0.8,
    reach: 2.5,
    arc: 0.55,
    windup: 0.22,
    cooldown: 0.8,
    stagger: 14,
    knock: 9,
    lift: 3,
    heft: "steady",
    blunt: true,
    siege: 1.0,
    hint: "Click to bash · rattles them for a moment",
  },
  /* Long reach. */
  spear: {
    name: "Spear",
    price: 170,
    damage: 15,
    wet: 1.6,
    reach: 4.2,
    arc: 0.94,
    windup: 0.16,
    cooldown: 0.75,
    stagger: 12,
    knock: 11,
    lift: 3,
    heft: "quick",
    siege: 0.18,
    hint: "Click to thrust · longest reach · strikes harder at anyone in the water",
  },
  halberd: {
    name: "Halberd",
    price: 260,
    damage: 20,
    speed: 0.9,
    reach: 3.8,
    arc: 0.3,
    windup: 0.4,
    cooldown: 1.2,
    stagger: 18,
    knock: 12,
    lift: 4,
    heft: "heavy",
    siege: 0.65,
    hint: "Click to sweep · a long, wide arc that catches everyone in it",
  },
  "staff-a": {
    name: "Staff A",
    price: 120,
    damage: 9,
    reach: 3.2,
    arc: 0.1,
    windup: 0.14,
    cooldown: 0.6,
    stagger: 12,
    knock: 12,
    lift: 3,
    heft: "steady",
    blunt: true,
    siege: 0.3,
    hint: "Click to sweep · a quick, wide quarterstaff that knocks them back",
  },
  /* Two hands, slow and crushing. */
  axe: {
    name: "Battle axe",
    price: 240,
    damage: 24,
    sunders: true,
    speed: 0.9,
    reach: 2.7,
    arc: 0.7,
    windup: 0.42,
    cooldown: 1.15,
    stagger: 24,
    knock: 13,
    lift: 5,
    heft: "heavy",
    siege: 1.3,
    hint: "Click to chop · cuts through shields",
  },
  greatsword: {
    name: "Greatsword",
    price: 300,
    damage: 18,
    charged: 34,
    charge: { min: 0.2, max: 1.2 },
    speed: 0.85,
    reach: 3,
    arc: 0.5,
    windup: 0.1,
    cooldown: 1.1,
    stagger: 16,
    knock: 9,
    lift: 4,
    heft: "heavy",
    siege: 1.0,
    hint: "Hold to raise it, release to cleave · the longer the harder",
  },
  hammer: {
    name: "Warhammer",
    price: 320,
    damage: 30,
    reach: 3,
    arc: -1,
    windup: 0.06,
    cooldown: 1.3,
    stagger: 25,
    knock: 8,
    lift: 10,
    charge: { min: 0.6, max: 0.6 },
    speed: 0.8,
    heft: "heavy",
    blunt: true,
    siege: 1.5,
    hint: "Hold, release to slam · launches everyone round you",
  },
  "sword-d": {
    name: "Sword D",
    price: 270,
    damage: 21,
    speed: 0.92,
    reach: 2.9,
    arc: 0.45,
    windup: 0.3,
    cooldown: 0.95,
    stagger: 15,
    knock: 10,
    lift: 3.5,
    heft: "heavy",
    siege: 0.6,
    hint: "Click to cleave · a broad blade in both hands",
  },
  /* Shooting: hold to draw a bow or gather a bolt, release to loose it. */
  "bow-a": {
    name: "Bow A",
    price: 220,
    damage: 7,
    charged: 20,
    charge: { min: 0.2, max: 1 },
    speed: 0.95,
    reach: 34,
    arc: 1,
    windup: 0.02,
    cooldown: 0.7,
    stagger: 6,
    knock: 4,
    lift: 1.5,
    heft: "quick",
    siege: 0.3,
    ranged: { shot: "arrow", speed: [30, 70], damage: [7, 20], spread: 0.006 },
    hint: "Hold to draw, release to loose · a full draw flies hardest",
  },
  "bow-b": {
    name: "Bow B",
    price: 300,
    damage: 9,
    charged: 28,
    charge: { min: 0.3, max: 1.4 },
    speed: 0.9,
    reach: 40,
    arc: 1,
    windup: 0.02,
    cooldown: 1,
    stagger: 9,
    knock: 6,
    lift: 2,
    heft: "steady",
    siege: 0.3,
    ranged: { shot: "arrow-b", speed: [34, 80], damage: [9, 28], spread: 0.005 },
    hint: "Hold to draw, release to loose · a heavy bow, slow to draw and far-reaching",
  },
  crossbow: {
    ...NO_BLOW,
    name: "Crossbow",
    reach: 50,
    price: 280,
    damage: 34,
    cooldown: 1.9,
    speed: 0.92,
    heft: "steady",
    siege: 0.35,
    ranged: { shot: "bolt", speed: [78, 78], damage: [34, 34], spread: 0.003 },
    hint: "Click to shoot · slow to wind, but it hits hard and flies flat",
  },
  firebow: {
    ...NO_BLOW,
    name: "Fire bow",
    reach: 30,
    price: 260,
    damage: 5,
    charged: 16,
    charge: { min: 0.2, max: 1 },
    cooldown: 0.5,
    heft: "quick",
    siege: 0.3,
    ignites: true,
    ranged: { shot: "firearrow", speed: [22, 50], damage: [5, 16], spread: 0.008 },
    hint: "Hold to draw, release to loose · pitch-soaked arrows set wood alight where they strike",
  },
  "wand-a": {
    name: "Wand A",
    price: 200,
    damage: 6,
    daze: 0.8,
    reach: 20,
    arc: 1,
    windup: 0.08,
    cooldown: 0.55,
    stagger: 6,
    knock: 4,
    lift: 1.5,
    heft: "quick",
    siege: 0.5,
    ranged: { shot: "magic", speed: [45, 45], damage: [6, 6], spread: 0.004 },
    hint: "Click to cast a quick bolt · leaves them dazed",
  },
  "staff-b": {
    name: "Staff B",
    price: 280,
    damage: 10,
    charged: 26,
    charge: { min: 0.25, max: 1.2 },
    speed: 0.95,
    reach: 26,
    arc: 1,
    windup: 0.05,
    cooldown: 1,
    stagger: 15,
    knock: 12,
    lift: 4,
    heft: "steady",
    siege: 0.4,
    ranged: { shot: "spell", speed: [32, 40], damage: [10, 26], spread: 0.004 },
    hint: "Hold to gather a bolt, release to cast · the longer, the harder it hits",
  },
  /* Shields: right-click to block, click to bash. */
  shield: {
    name: "Round shield",
    price: 140,
    damage: 5,
    reach: 2.2,
    arc: 0.5,
    windup: 0.08,
    cooldown: 0.8,
    stagger: 8,
    knock: 10,
    lift: 3,
    heft: "steady",
    blunt: true,
    guard: { cover: 0.2, leak: 0, parry: 0.25 },
    siege: 0.35,
    hint: "Right-click to block · click to bash · block late to parry",
  },
  "shield-a": {
    name: "Shield A",
    price: 120,
    damage: 5,
    speed: 1.02,
    reach: 2.1,
    arc: 0.5,
    windup: 0.06,
    cooldown: 0.6,
    stagger: 7,
    knock: 9,
    lift: 2.5,
    heft: "steady",
    blunt: true,
    guard: { cover: 0.4, leak: 0.1, parry: 0.4 },
    siege: 0.3,
    hint: "Right-click to block · small and quick: the easiest to parry with",
  },
  kite: {
    name: "Kite shield",
    price: 200,
    damage: 4,
    speed: 0.88,
    reach: 2.2,
    arc: 0.5,
    windup: 0.12,
    cooldown: 0.9,
    stagger: 10,
    knock: 15,
    lift: 3.5,
    heft: "steady",
    blunt: true,
    guard: { cover: -0.15, leak: 0, parry: 0.15, firm: true },
    siege: 0.5,
    hint: "Right-click to block · guards your flanks and holds even against axes",
  },
  spiked: {
    name: "Spiked shield",
    price: 180,
    damage: 9,
    bleed: 4,
    reach: 2.2,
    arc: 0.5,
    windup: 0.08,
    cooldown: 0.8,
    stagger: 9,
    knock: 9,
    lift: 2.5,
    heft: "steady",
    guard: { cover: 0.3, leak: 0.25, parry: 0.25, thorns: 5 },
    siege: 0.2,
    hint: "Right-click to block · its spikes bite whoever strikes it, and its bash draws blood",
  },
  /* Tools for a raid, and for the morning after. */
  torch: {
    name: "Torch",
    price: 60,
    damage: 6,
    reach: 2.4,
    arc: 0.5,
    windup: 0.12,
    cooldown: 0.7,
    stagger: 6,
    knock: 5,
    lift: 2,
    heft: "steady",
    blunt: true,
    siege: 0.3,
    ignites: true,
    hint: "Click on anything wooden to set it alight · stone won't burn",
  },
  bucket: {
    name: "Water bucket",
    price: 25,
    damage: 3,
    reach: 2.6,
    arc: 0.45,
    windup: 0.1,
    cooldown: 0.8,
    stagger: 4,
    knock: 5,
    lift: 2,
    heft: "steady",
    blunt: true,
    siege: 0.1,
    douses: true,
    hint: "Click on something burning to douse it · fill it in the sea or at a well",
  },
  /* Things to throw: bought each, carried beside your weapon. */
  keg: {
    ...NO_BLOW,
    name: "Powder keg",
    price: 150,
    damage: 0,
    cooldown: 1,
    speed: 0.9,
    heft: "heavy",
    throws: { shot: "keg", speed: 9 },
    hint: "Click to set it down, or look up to lob it · a four-second fuse, then it brings down stone",
  },
  smokebomb: {
    ...NO_BLOW,
    name: "Smoke bomb",
    price: 60,
    damage: 0,
    cooldown: 0.8,
    heft: "quick",
    throws: { shot: "smoke", speed: 17 },
    hint: "Click to throw · a thick cloud for eight seconds that towers and guns can't see through",
  },
};

/* Something you throw and use up, carried beside your weapon rather than as it. */
export const isThrown = (kind: WeaponKind | null) => !!kind && !!WEAPONS[kind].throws;

export function weaponDef(kind: WeaponKind | null) {
  return kind ? WEAPONS[kind] : FISTS;
}

/* 0..1: how far a charged weapon was wound up, from the seconds it was held. */
export function chargePower(def: WeaponDef, held: number) {
  const c = def.charge;
  if (!c || c.max <= c.min) return 1;
  return Math.max(0, Math.min(1, (held - c.min) / (c.max - c.min)));
}

/* Stagger caps here; past this you're already flying. */
export const STAGGER_MAX = 250;
/* Seconds after a hit before stagger starts to wear off, and how fast. */
export const STAGGER_GRACE = 3;
export const STAGGER_RECOVER = 5;
/* Swings this close together count toward a combo. */
export const COMBO_WINDOW = 1;
/* A bleed runs out over this many seconds, in one-second ticks. */
export const BLEED_TIME = 3;
/* How fast a dazed body moves. */
export const DAZE_SPEED = 0.6;

/* How much harder everything hits a player with this much stagger. */
export function knockScale(stagger: number) {
  return 1 + stagger / 90;
}

/* Index for the compact snapshot: 0 is empty-handed. */
export function weaponIndex(kind: WeaponKind | null) {
  return kind ? WEAPON_KINDS.indexOf(kind) + 1 : 0;
}

export function weaponFromIndex(i: number): WeaponKind | null {
  return i > 0 ? (WEAPON_KINDS[i - 1] ?? null) : null;
}

/*
 * How a weapon is held, which picks the character's animations: one hand,
 * two hands, a pair, a long shaft, a shield on the arm, a bow, a crossbow, or a
 * spell caster (a wand or a mage's staff).
 */
export type Grip =
  | "unarmed"
  | "1h"
  | "2h"
  | "dual"
  | "polearm"
  | "shield"
  | "bow"
  | "crossbow"
  | "magic";

const GRIPS: Record<WeaponKind, Grip> = {
  daggers: "dual",
  "dagger-b": "1h",
  knuckles: "dual",
  "fistweapon-b": "dual",
  cutlass: "1h",
  "sword-a": "1h",
  "sword-b": "1h",
  "axe-a": "1h",
  beardaxe: "1h",
  mallet: "1h",
  "hammer-c": "1h",
  morningstar: "1h",
  spear: "polearm",
  halberd: "polearm",
  "staff-a": "2h",
  axe: "2h",
  "sword-d": "2h",
  greatsword: "2h",
  hammer: "2h",
  "bow-a": "bow",
  "bow-b": "bow",
  "wand-a": "magic",
  "staff-b": "magic",
  shield: "shield",
  "shield-a": "shield",
  kite: "shield",
  spiked: "shield",
  torch: "1h",
  bucket: "1h",
  crossbow: "crossbow",
  firebow: "bow",
  keg: "1h",
  smokebomb: "1h",
};

export const gripOf = (kind: WeaponKind | null): Grip => (kind ? GRIPS[kind] : "unarmed");

/* The shield's guard, if this is a shield. */
export const guardOf = (kind: WeaponKind | null): Guard | null =>
  kind ? (WEAPONS[kind].guard ?? null) : null;
