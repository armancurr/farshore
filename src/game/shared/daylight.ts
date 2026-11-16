import { DAY_LENGTH, DAY_START } from "./constants";
import { smoothstep } from "./math";

/* Where we are in the day, 0..1 from midnight, for a world clock in seconds. */
export function dayFraction(time: number) {
  const f = time / DAY_LENGTH + DAY_START;
  return f - Math.floor(f);
}

/* Which day it is, counting from 1. */
export function dayNumber(time: number) {
  return Math.floor(time / DAY_LENGTH + DAY_START) + 1;
}

/* Height of the sun: 1 at noon, 0 at six, -1 at midnight. */
export function sunElevation(time: number) {
  return Math.sin((dayFraction(time) - 0.25) * Math.PI * 2);
}

/* 0 at night, 1 in full day, easing through dawn and dusk. */
export function daylight(time: number) {
  return smoothstep(-0.12, 0.3, sunElevation(time));
}

export function isNight(time: number) {
  return sunElevation(time) < -0.05;
}

/* Seconds of world time until the next dawn (six in the morning). */
export function untilDawn(time: number) {
  const f = dayFraction(time);
  return ((0.25 - f + 1) % 1 || 1) * DAY_LENGTH;
}

export function clockLabel(time: number) {
  const minutes = Math.floor(dayFraction(time) * 24 * 60);
  const hh = String(Math.floor(minutes / 60)).padStart(2, "0");
  const mm = String(minutes % 60).padStart(2, "0");
  const f = dayFraction(time);
  const part =
    f < 0.21
      ? "Night"
      : f < 0.29
        ? "Dawn"
        : f < 0.48
          ? "Morning"
          : f < 0.71
            ? "Afternoon"
            : f < 0.79
              ? "Dusk"
              : "Night";
  return { day: dayNumber(time), time: `${hh}:${mm}`, part };
}
