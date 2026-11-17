/*
 * The wind over the archipelago: one steady breeze from the south-west, the
 * same for everyone because it's a pure function of world time. The clouds
 * ride it (so the whole sky creeps one way, like the world turning under it)
 * and anything with a sail feels it.
 */

/* Where the wind blows toward (radians, 0 = +x, measured toward +z), and how hard (m/s). */
export const WIND_HEADING = -0.62;
export const WIND_SPEED = 3.2;

/* The wind's velocity at time t (seconds of world time): steady, with slow gusts. */
export function windAt(t: number) {
  const gust = 1 + 0.18 * Math.sin(t * 0.021) + 0.08 * Math.sin(t * 0.093 + 1.7);
  const veer = 0.12 * Math.sin(t * 0.013 + 0.4);
  const a = WIND_HEADING + veer;
  const s = WIND_SPEED * gust;
  return { x: Math.cos(a) * s, z: Math.sin(a) * s };
}

/*
 * How far the air has carried something since time 0: the clouds' drift.
 * Clouds ignore the gusts (they'd make the whole sky lurch) and keep the
 * steady part of the wind.
 */
export function windDrift(t: number) {
  return {
    x: Math.cos(WIND_HEADING) * WIND_SPEED * t,
    z: Math.sin(WIND_HEADING) * WIND_SPEED * t,
  };
}
