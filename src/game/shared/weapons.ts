/*
 * Close-quarters weapons, chosen from the marketplace. You carry one at a time.
 * A hit takes health (in survival, and off the Harbor) and adds stagger;
 * stagger multiplies knockback, so a battered fighter flies further.
 */

export type WeaponKind =
  | "daggers"
  | "sickle"
  | "machete"
  | "boardaxe"
  | "spear"
  | "trident"
  | "mace"
  | "halberd"
  | "axe"
  | "greatsword"
  | "hammer"
  | "shield";

/* In marketplace order: quick and light first, then the heavy hitters, then the shield. */
export const WEAPON_KINDS: readonly WeaponKind[] = [
  "daggers",
  "sickle",
  "machete",
  "boardaxe",
  "spear",
  "trident",
  "mace",
  "halberd",
  "axe",
  "greatsword",
  "hammer",
  "shield",
];

export const isWeaponKind = (v: unknown): v is WeaponKind =>
  typeof v === "string" && (WEAPON_KINDS as readonly string[]).includes(v);

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
  hint: "Click to shove",
};

export const WEAPONS: Record<WeaponKind, WeaponDef> = {
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
    hint: "Click to jab · far deadlier from behind",
  },
  sickle: {
    name: "Sickle",
    price: 140,
    damage: 9,
    bleed: 6,
    pull: 5,
    reach: 2.1,
    arc: 0.55,
    windup: 0.08,
    cooldown: 0.4,
    stagger: 6,
    knock: 0,
    lift: 1.5,
    hint: "Click to hook · draws them in and draws blood",
  },
  machete: {
    name: "Machete",
    price: 150,
    damage: 11,
    combo: 18,
    reach: 2.5,
    arc: 0.55,
    windup: 0.1,
    cooldown: 0.38,
    stagger: 7,
    knock: 5,
    lift: 2,
    hint: "Click to hack · every third swing chops deep",
  },
  boardaxe: {
    name: "Boarding axe",
    price: 180,
    damage: 14,
    pull: 7,
    reach: 2.6,
    arc: 0.6,
    windup: 0.2,
    cooldown: 0.7,
    stagger: 10,
    knock: 0,
    lift: 2.5,
    hint: "Click to swing · the bearded blade drags them to you",
  },
  spear: {
    name: "Spear",
    price: 160,
    damage: 15,
    reach: 4.2,
    arc: 0.94,
    windup: 0.16,
    cooldown: 0.75,
    stagger: 12,
    knock: 11,
    lift: 3,
    hint: "Click to thrust · longest reach",
  },
  trident: {
    name: "Trident",
    price: 220,
    damage: 16,
    wet: 1.5,
    reach: 3.8,
    arc: 0.9,
    windup: 0.18,
    cooldown: 0.8,
    stagger: 12,
    knock: 10,
    lift: 3.5,
    hint: "Click to thrust · strikes harder at anyone in the water",
  },
  mace: {
    name: "Mace",
    price: 200,
    damage: 20,
    daze: 1.5,
    reach: 2.4,
    arc: 0.6,
    windup: 0.3,
    cooldown: 1,
    stagger: 18,
    knock: 9,
    lift: 3.5,
    hint: "Click to bludgeon · leaves them dazed and slow",
  },
  halberd: {
    name: "Halberd",
    price: 260,
    damage: 22,
    reach: 3.8,
    arc: 0.3,
    windup: 0.4,
    cooldown: 1.2,
    stagger: 18,
    knock: 12,
    lift: 4,
    hint: "Click to sweep · a long, wide arc that catches everyone in it",
  },
  axe: {
    name: "Battle axe",
    price: 240,
    damage: 24,
    sunders: true,
    reach: 2.6,
    arc: 0.7,
    windup: 0.42,
    cooldown: 1.15,
    stagger: 24,
    knock: 13,
    lift: 5,
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
    hint: "Hold, release to slam · launches everyone round you",
  },
  shield: {
    name: "Shield",
    price: 140,
    damage: 5,
    reach: 2.2,
    arc: 0.5,
    windup: 0.08,
    cooldown: 0.8,
    stagger: 8,
    knock: 10,
    lift: 3,
    hint: "Right-click to block · click to bash · block late to parry",
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
/* A shield raised this soon before a hit parries it. */
export const PARRY_WINDOW = 0.25;
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
 * two hands, a pair, a long shaft, or a shield on the arm.
 */
export type Grip = "unarmed" | "1h" | "2h" | "dual" | "polearm" | "shield";

const GRIPS: Record<WeaponKind, Grip> = {
  daggers: "dual",
  sickle: "1h",
  machete: "1h",
  boardaxe: "1h",
  spear: "polearm",
  trident: "polearm",
  mace: "1h",
  halberd: "polearm",
  axe: "2h",
  greatsword: "2h",
  hammer: "2h",
  shield: "shield",
};

export const gripOf = (kind: WeaponKind | null): Grip => (kind ? GRIPS[kind] : "unarmed");
