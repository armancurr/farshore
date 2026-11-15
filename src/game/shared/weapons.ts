/*
 * Melee weapons. Nobody dies from a hit: each one adds to the victim's
 * stagger, and stagger multiplies knockback, so a battered player flies
 * further and further until the sea takes them.
 */

export type WeaponKind =
  | "sword"
  | "axe"
  | "spear"
  | "hammer"
  | "pickaxe"
  | "daggers"
  | "shield"
  | "flail";

export const WEAPON_KINDS: readonly WeaponKind[] = [
  "sword",
  "axe",
  "spear",
  "hammer",
  "pickaxe",
  "daggers",
  "shield",
  "flail",
];

export type WeaponDef = {
  name: string;
  /* Swings before it breaks. */
  uses: number;
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
  /* Move speed while carrying it. */
  speed?: number;
  hint: string;
};

export const FISTS: WeaponDef = {
  name: "Fists",
  uses: Number.POSITIVE_INFINITY,
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
  sword: {
    name: "Sword",
    uses: 14,
    reach: 2.8,
    arc: 0.55,
    windup: 0.12,
    cooldown: 0.42,
    stagger: 7,
    knock: 5.5,
    lift: 2.5,
    hint: "Click to slash · every third swing launches",
  },
  axe: {
    name: "Battle axe",
    uses: 7,
    reach: 2.6,
    arc: 0.7,
    windup: 0.42,
    cooldown: 1.15,
    stagger: 24,
    knock: 13,
    lift: 5,
    hint: "Click to chop · cuts through shields",
  },
  spear: {
    name: "Spear",
    uses: 10,
    reach: 4.2,
    arc: 0.94,
    windup: 0.16,
    cooldown: 0.75,
    stagger: 12,
    knock: 11,
    lift: 3,
    hint: "Click to thrust · longest reach",
  },
  hammer: {
    name: "Warhammer",
    uses: 5,
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
  pickaxe: {
    name: "Pickaxe",
    uses: 10,
    reach: 2.4,
    arc: 0.6,
    windup: 0.2,
    cooldown: 0.65,
    stagger: 10,
    knock: 8,
    lift: 3,
    hint: "Click to swing · swing at a wall or cliff to climb it",
  },
  daggers: {
    name: "Twin daggers",
    uses: 24,
    reach: 1.9,
    arc: 0.6,
    windup: 0.05,
    cooldown: 0.22,
    stagger: 5,
    knock: 1.5,
    lift: 0.6,
    hint: "Click to jab · triple stagger from behind",
  },
  shield: {
    name: "Shield",
    uses: 10,
    reach: 2.2,
    arc: 0.5,
    windup: 0.08,
    cooldown: 0.8,
    stagger: 8,
    knock: 10,
    lift: 3,
    hint: "Right-click to block · click to bash · block late to parry",
  },
  flail: {
    name: "Flail",
    uses: 6,
    reach: 2.7,
    arc: -1,
    windup: 0.05,
    cooldown: 0.9,
    stagger: 6,
    knock: 8,
    lift: 3,
    charge: { min: 0.25, max: 2 },
    hint: "Hold to spin it up, release to strike everyone round you",
  },
};

export function weaponDef(kind: WeaponKind | null) {
  return kind ? WEAPONS[kind] : FISTS;
}

/* Stagger caps here; past this you're already flying. */
export const STAGGER_MAX = 250;
/* Seconds after a hit before stagger starts to wear off, and how fast. */
export const STAGGER_GRACE = 3;
export const STAGGER_RECOVER = 5;
/* A shield raised this soon before a hit parries it. */
export const PARRY_WINDOW = 0.25;
/* Sword: swings this close together count toward the combo. */
export const COMBO_WINDOW = 1;

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
