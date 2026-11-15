import {
  GRACE,
  SURGE_DURATION,
  SURGE_INTERVAL,
  SURGE_STEP,
  SURGE_WARNING,
  TIDE_START,
} from "./constants";
import { smoothstep } from "./math";

/*
 * The tide is a pure function of round time, so every client can draw it
 * smoothly from a shared clock. `hurry` adds a constant climb once the room
 * decides the round should wrap up.
 */
export function tideAt(t: number, hurryFrom = Number.POSITIVE_INFINITY, hurryRate = 0) {
  let level = TIDE_START;
  if (t > GRACE) {
    const since = t - GRACE;
    const done = Math.floor(since / SURGE_INTERVAL);
    const into = since - done * SURGE_INTERVAL;
    level += SURGE_STEP * (done + smoothstep(0, SURGE_DURATION, into));
  }
  if (t > hurryFrom) level += (t - hurryFrom) * hurryRate;
  return level;
}

export type TidePhase = { surging: boolean; nextIn: number; warning: boolean; grace: boolean };

export function tidePhase(t: number): TidePhase {
  if (t < GRACE) {
    const nextIn = GRACE - t;
    return { surging: false, nextIn, warning: nextIn < SURGE_WARNING, grace: true };
  }
  const into = (t - GRACE) % SURGE_INTERVAL;
  const surging = into < SURGE_DURATION;
  const nextIn = SURGE_INTERVAL - into;
  return { surging, nextIn, warning: !surging && nextIn < SURGE_WARNING, grace: false };
}

/* Where the sea will sit once the next surge settles. */
export function nextTide(t: number) {
  return tideAt(t + tidePhase(t).nextIn + SURGE_DURATION);
}
