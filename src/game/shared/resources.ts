import { ISLAND_RADIUS, SEA_LEVEL } from "./constants";
import { mulberry32, range } from "./math";
import type { Terrain } from "./terrain";

export type Resource = {
  id: number;
  kind: "bush" | "stone";
  x: number;
  y: number;
  z: number;
  rotation: number;
  size: number;
};

/* Generated identically by the room and clients, so the room can validate pickups. */
export function groundResources(terrain: Terrain): Resource[] {
  const rng = mulberry32(terrain.seed ^ 0x47524153);
  const result: Resource[] = [];
  let bushes = 0;
  let stones = 0;
  for (let attempt = 0; attempt < 25000 && (bushes < 1800 || stones < 900); attempt++) {
    const angle = rng() * Math.PI * 2;
    const radius = Math.sqrt(rng()) * ISLAND_RADIUS;
    const x = Math.cos(angle) * radius;
    const z = Math.sin(angle) * radius;
    const y = terrain.heightAt(x, z);
    if (y < SEA_LEVEL + 0.7 || terrain.normalAt(x, z)[1] < 0.78) continue;
    if (bushes++ < 1800)
      result.push({
        id: attempt * 2,
        kind: "bush",
        x,
        y,
        z,
        rotation: angle,
        size: range(rng, 0.6, 1.05),
      });
    if (stones < 900 && rng() < 0.1) {
      const size = range(rng, 0.06, 0.13);
      result.push({ id: attempt * 2 + 1, kind: "stone", x: x + 0.4, y, z, rotation: angle, size });
      stones++;
    }
  }
  return result;
}
