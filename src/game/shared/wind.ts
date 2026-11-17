/*
 * The wind over the whole sea: one direction and one strength everywhere,
 * a pure function of world time, so the room and every client agree on it
 * without sending it. Sails trim to it, flags stream in it, and the clouds
 * can drift with it.
 *
 * It wanders slowly round a prevailing heading (a sailor can count on it for
 * a crossing) and gusts up and dies down over a few minutes.
 */

export type Wind = {
  /* The heading the wind blows toward, in the same convention as a body's yaw (0 is toward -z). */
  angle: number;
  /* 0 (a breath) to 1 (a stiff breeze). */
  strength: number;
  /* Metres a second, and as a velocity on the ground plane. */
  speed: number;
  x: number;
  z: number;
};

export const WIND_MIN = 3;
export const WIND_MAX = 11;

/* Blowing toward the north-west, more or less, off the open sea. */
const PREVAILING = 0.9;

export function windAt(t: number): Wind {
  const angle = PREVAILING + 0.7 * Math.sin(t / 105) + 0.3 * Math.sin(t / 37 + 1.3);
  const gust = 0.55 + 0.28 * Math.sin(t / 83 + 0.4) + 0.14 * Math.sin(t / 23 + 2.1);
  const strength = Math.min(1, Math.max(0.15, gust));
  const speed = WIND_MIN + (WIND_MAX - WIND_MIN) * strength;
  return { angle, strength, speed, x: -Math.sin(angle) * speed, z: -Math.cos(angle) * speed };
}

/*
 * How much of a sail's best speed it makes with the wind `off` radians from
 * dead astern (0 running before it, π heading straight into it). Best on a
 * broad reach, a little less running dead downwind, and nothing much close to
 * the wind: but never quite nothing, so you can always claw your way out of
 * irons.
 */
export function sailPolar(off: number) {
  const a = Math.abs(off);
  /* Into the wind: from 145° off the stern (35° off the bow) there's nothing to be had. */
  const close = Math.min(1, Math.max(0, (Math.PI * 0.81 - a) / 0.5));
  const reach = 0.78 + 0.22 * Math.sin(Math.min(a, Math.PI * 0.75) * (2 / 1.5));
  return Math.max(0.14, close * reach);
}
