/*
 * Weapons, chosen from the marketplace. You carry one at a time. Most are for
 * close quarters; the bows, the wand and the mage's staff shoot.
 * A hit takes health (in survival, and off the Harbor) and adds stagger;
 * stagger multiplies knockback, so a battered fighter flies further.
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
  | "wand-a"
  | "staff-b"
  | "shield"
  | "shield-a"
  | "kite"
  | "spiked";

/*
 * In marketplace order: quick and light first, then the long reach, then the
 * heavy hitters, then what shoots, then the shields. The snapshot sends a
 * weapon as its place in this list, so client and server must share it (they
 * do: it lives here).
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
  "wand-a",
  "staff-b",
  "shield",
  "shield-a",
  "kite",
  "spiked",
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
 * What a shooting weapon looses: an arrow (the pack's arrow_A or arrow_B) or a
 * bolt of magic. It flies at `speed` (m/s) straight down the line you look
 * along, out to the weapon's `reach`, and hits the first thing within
 * `radius` (m) of that line.
 */
export type Shot = { flies: "arrow-a" | "arrow-b" | "bolt"; speed: number; radius: number };

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
  /* Bows and magic: it shoots, out to `reach`, instead of swinging. */
  shot?: Shot;
  hint: string;
};

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
    shot: { flies: "arrow-a", speed: 70, radius: 0.5 },
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
    shot: { flies: "arrow-b", speed: 80, radius: 0.5 },
    hint: "Hold to draw, release to loose · a heavy bow, slow to draw and far-reaching",
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
    shot: { flies: "bolt", speed: 45, radius: 0.6 },
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
    shot: { flies: "bolt", speed: 40, radius: 0.8 },
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
    hint: "Right-click to block · its spikes bite whoever strikes it, and its bash draws blood",
  },
};

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
 * two hands, a pair, a long shaft, a shield on the arm, a bow, or a spell
 * caster (a wand or a mage's staff).
 */
export type Grip = "unarmed" | "1h" | "2h" | "dual" | "polearm" | "shield" | "bow" | "magic";

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
};

export const gripOf = (kind: WeaponKind | null): Grip => (kind ? GRIPS[kind] : "unarmed");

/* What it shoots, if it shoots. */
export const shotOf = (kind: WeaponKind | null): Shot | null =>
  kind ? (WEAPONS[kind].shot ?? null) : null;

/* The shield's guard, if this is a shield. */
export const guardOf = (kind: WeaponKind | null): Guard | null =>
  kind ? (WEAPONS[kind].guard ?? null) : null;
