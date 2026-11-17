import { SEA_FLOOR } from "./constants";
import type { IslandInfo } from "./islands";
import type { Berth } from "./places";
import type { Ladder } from "./structures";
import { type Ground, type Solid, Terrain } from "./terrain";

export type Island = { info: IslandInfo; terrain: Terrain };

const OPEN_SEA = { ground: SEA_FLOOR, onSolid: false };
const FLAT: [number, number, number] = [0, 1, 0];
const NONE: readonly Solid[] = [];

/*
 * The grand map: open sea with the islands in it. Any question about
 * the ground goes to the island whose tile holds the point; anywhere else is
 * deep water. Tiles never overlap, so there's only ever one to ask.
 */
export class Archipelago implements Ground {
  readonly islands = new Map<number, Island>();
  ladders: Ladder[] = [];
  /* Every pier's berths, on every island. */
  berths: Berth[] = [];
  /* Everything built, by key, so an island that arrives later still collides with it. */
  private dynamic = new Map<number, readonly Solid[]>();
  /* The same, all together: what's out on the open sea between the tiles. */
  private loose: Solid[] = [];
  private last: Terrain | null = null;

  constructor(islands: readonly IslandInfo[] = []) {
    for (const info of islands) this.add(info);
  }

  /* Raise an island (or hand back the one already there). */
  add(info: IslandInfo): Island {
    const had = this.islands.get(info.id);
    if (had) return had;
    const terrain = new Terrain(info);
    const island = { info: { ...info }, terrain };
    this.islands.set(info.id, island);
    this.ladders = [...this.islands.values()].flatMap((o) => o.terrain.ladders);
    this.berths = [...this.islands.values()].flatMap((o) => o.terrain.berths);
    for (const [key, solids] of this.dynamic) this.register(terrain, key, solids);
    return island;
  }

  list(): IslandInfo[] {
    return [...this.islands.values()].map((o) => o.info);
  }

  /* The first island raised: the Harbor, where the lighthouse and the Guild Board stand. */
  get primary(): Terrain | null {
    return this.islands.values().next().value?.terrain ?? null;
  }

  /* The island under (x, z), if any. */
  at(x: number, z: number): Terrain | null {
    const last = this.last;
    if (last?.contains(x, z)) return last;
    for (const { terrain } of this.islands.values()) {
      if (terrain.contains(x, z)) {
        this.last = terrain;
        return terrain;
      }
    }
    return null;
  }

  /* The highest peak anywhere, for clamping how high a body can be. */
  get peak() {
    let top = 0;
    for (const { terrain } of this.islands.values()) top = Math.max(top, terrain.peak);
    return top;
  }

  heightAt(x: number, z: number) {
    return this.at(x, z)?.heightAt(x, z) ?? SEA_FLOOR;
  }

  normalAt(x: number, z: number): [number, number, number] {
    return this.at(x, z)?.normalAt(x, z) ?? FLAT;
  }

  groundAt(x: number, z: number, feetY: number) {
    return this.at(x, z)?.groundAt(x, z, feetY) ?? OPEN_SEA;
  }

  solidsNear(x: number, z: number) {
    const island = this.at(x, z);
    if (island) return island.solidsNear(x, z);
    return this.loose.length ? this.loose : NONE;
  }

  addSolids(key: number, solids: readonly Solid[]) {
    this.dynamic.set(key, solids);
    for (const { terrain } of this.islands.values()) this.register(terrain, key, solids);
    this.gather();
  }

  removeSolids(key: number) {
    if (!this.dynamic.delete(key)) return;
    for (const { terrain } of this.islands.values()) terrain.removeSolids(key);
    this.gather();
  }

  private gather() {
    this.loose = [...this.dynamic.values()].flat();
  }

  private register(terrain: Terrain, key: number, solids: readonly Solid[]) {
    const mine = solids.filter((s) => terrain.contains(s.x, s.z, s.r + 1));
    if (mine.length) terrain.addSolids(key, mine);
    else terrain.removeSolids(key);
  }
}
