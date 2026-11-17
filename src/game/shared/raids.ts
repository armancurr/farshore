import { TEAMS, type Team } from "./catalogue";

/*
 * Raids: setting foot (or keel) on someone else's land makes you a raider
 * there, and a raider who holds its Hearth long enough captures it, takes a
 * share of the owner's purse, and leaves the isle shielded a while. The
 * numbers live here, shared, so the room, the HUD and the tests agree.
 */

/* Off the plot this long (seconds) and you're no longer raiding it. */
export const RAID_GRACE = 10;

/* Standing this close to a Hearth's middle (metres, on or at the plinth) takes it. */
export const CAPTURE_RADIUS = 4;
/* And this far above or below its top. */
export const CAPTURE_RISE = 3;
/* Seconds of holding it, alone, to capture it. */
export const CAPTURE_TIME = 20;
/* With nobody holding it, progress falls back this many seconds a second. */
export const CAPTURE_DECAY = 0.25;
/* Each raider past the first adds a little, up to half as fast again. */
export const CAPTURE_BONUS = 0.25;
export const CAPTURE_MAX_RATE = 1.5;

/* What a capture takes from the owner's purse. */
export const PLUNDER_SHARE = 0.3;

/* The owner isn't woken again by more raiders landing for this long (seconds). */
export const ALARM_GAP = 60;

/* How a capture is going, on the wire: falling back, being taken, or held by both sides. */
export const CAPTURE_STATE = { falling: 0, taking: 1, contested: 2 } as const;
export type CaptureState = (typeof CAPTURE_STATE)[keyof typeof CAPTURE_STATE];

/* Seconds of capture a second, for this many raiders at the Hearth. */
export function captureRate(raiders: number) {
  if (raiders <= 0) return 0;
  return Math.min(CAPTURE_MAX_RATE, 1 + CAPTURE_BONUS * (raiders - 1));
}

/*
 * One step of a capture: raiders alone at the Hearth take it, anyone
 * defending it there holds it where it is, and left alone it falls back.
 */
export function stepCapture(progress: number, raiders: number, defenders: number, dt: number) {
  if (raiders > 0 && defenders > 0)
    return { progress, state: CAPTURE_STATE.contested as CaptureState };
  if (raiders > 0)
    return {
      progress: Math.min(CAPTURE_TIME, progress + captureRate(raiders) * dt),
      state: CAPTURE_STATE.taking as CaptureState,
    };
  return {
    progress: Math.max(0, progress - CAPTURE_DECAY * dt),
    state: CAPTURE_STATE.falling as CaptureState,
  };
}

/* The coins a capture takes from a purse of `wallet`. */
export const plunderOf = (wallet: number) => Math.floor(Math.max(0, wallet) * PLUNDER_SHARE);

/* The way to (dx, dz) from the middle of an isle, as a sailor says it (north is -z). */
export function compass(dx: number, dz: number) {
  const names = [
    "north",
    "north-east",
    "east",
    "south-east",
    "south",
    "south-west",
    "west",
    "north-west",
  ];
  const a = Math.atan2(dx, -dz);
  return names[(Math.round(a / (Math.PI / 4)) + 8) % 8];
}

/*
 * The colours a captor flies on the Hearth they took: their own land's, or,
 * without land, one picked from their name that isn't the owner's.
 */
export function raiderTeam(own: Team | null, owner: Team, name: string): Team {
  if (own) return own;
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  const others = TEAMS.filter((t) => t !== owner);
  return others[h % others.length];
}
