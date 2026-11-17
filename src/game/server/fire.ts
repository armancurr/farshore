import { CATALOGUE, type PlacedItem } from "../shared/catalogue";
import { shielded } from "../shared/plots";
import { FIRE, fireRadius, spreadChance } from "../shared/siege";
import type { Wind } from "../shared/wind";

/*
 * Fire on the plots, as the room runs it. Each plot is a few dozen to a few
 * hundred things, each with its own footprint, material and health, so the
 * fire works on them directly rather than on a grid: every half second each
 * burning thing burns itself down a little and may set the wooden things
 * near it going, likelier the closer they are and the more downwind. Only
 * burning things look about them, and there are never more than FIRE.maxRoom
 * of those, so a step costs at most that many passes over a plot's things.
 * Nothing about a fire is saved: a fire in progress when the room stops just
 * goes out.
 */

/* What the fire needs of a plot. A shielded plot's fires burn out without spreading. */
export type FirePlot = { id: number; items: PlacedItem[]; shield?: number };

type Blaze = { plot: number; item: PlacedItem; since: number; until: number };

/* What a water barrel or a well has left, and when its next charge comes back. */
type Tank = { left: number; nextAt: number };

export interface FireHost {
  rng(): number;
  /* The fire takes this much health from it; the room decides what that does (rubble, say). */
  scorch(plot: FirePlot, item: PlacedItem, amount: number): void;
  /* It caught, or went out: doused with water, or burnt out by itself. */
  changed(item: PlacedItem, doused: boolean): void;
}

export class Fires {
  readonly burning = new Map<number, Blaze>();
  /* Burnt out or soaked: it won't catch again until then. */
  private cool = new Map<number, number>();
  private tanks = new Map<number, Tank>();
  private acc = 0;

  constructor(private readonly host: FireHost) {}

  isBurning(id: number) {
    return this.burning.has(id);
  }

  /* Wooden, standing, not already alight, and not still damp or smouldering out. */
  canCatch(item: PlacedItem, now: number) {
    return (
      CATALOGUE[item.kind].material === "wood" &&
      item.hp > 0 &&
      !this.burning.has(item.id) &&
      (this.cool.get(item.id) ?? 0) <= now
    );
  }

  /* Set it alight, if it will burn and there's room for another fire. */
  ignite(plot: FirePlot, item: PlacedItem, now: number) {
    if (!this.canCatch(item, now) || this.burning.size >= FIRE.maxRoom) return false;
    let here = 0;
    for (const b of this.burning.values()) if (b.plot === plot.id) here++;
    if (here >= FIRE.maxPlot) return false;
    const [lo, hi] = FIRE.life;
    this.burning.set(item.id, {
      plot: plot.id,
      item,
      since: now,
      until: now + lo + this.host.rng() * (hi - lo),
    });
    this.host.changed(item, false);
    return true;
  }

  /* Put it out: with water (it stays damp a while), or because it burnt out. */
  out(id: number, now: number, doused: boolean) {
    const b = this.burning.get(id);
    if (!b) return false;
    this.burning.delete(id);
    this.cool.set(id, now + (doused ? FIRE.soaked : FIRE.cooldown));
    this.host.changed(b.item, doused);
    return true;
  }

  /* It's gone (sold, or fallen): forget it without a word. */
  drop(id: number) {
    this.burning.delete(id);
    this.cool.delete(id);
    this.tanks.delete(id);
  }

  /* Charges left in a water barrel or well right now (topped up as they come back). */
  charges(item: PlacedItem, now: number) {
    return this.tank(item, now)?.left ?? 0;
  }

  private tank(item: PlacedItem, now: number) {
    const d = CATALOGUE[item.kind].douse;
    if (!d) return null;
    let t = this.tanks.get(item.id);
    if (!t) this.tanks.set(item.id, (t = { left: d.charges, nextAt: 0 }));
    while (t.left < d.charges && now >= t.nextAt) {
      t.left++;
      t.nextAt += d.refill;
    }
    return t;
  }

  /* A barrel or well on the same plot with water to spare, near enough: it spends a charge. */
  private waterFor(plot: FirePlot, item: PlacedItem, now: number) {
    const r = fireRadius(item.kind);
    for (const o of plot.items) {
      const d = CATALOGUE[o.kind].douse;
      if (!d || o.hp <= 0) continue;
      if (Math.hypot(o.x - item.x, o.z - item.z) - r > d.radius) continue;
      const t = this.tank(o, now);
      if (!t || t.left < 1) continue;
      if (t.left === d.charges) t.nextAt = now + d.refill;
      t.left--;
      return true;
    }
    return false;
  }

  /*
   * Every FIRE.step: each fire dies down if its time is up, is doused by a
   * barrel or well in reach, or burns on, and once it's been going a few
   * seconds it may catch whatever wooden things are near it.
   */
  step(plots: ReadonlyMap<number, FirePlot>, now: number, wind: Wind, dt: number) {
    this.acc += dt;
    if (this.acc < FIRE.step) return;
    const step = this.acc;
    this.acc = 0;
    for (const [id, b] of [...this.burning]) {
      if (!this.burning.has(id)) continue;
      const plot = plots.get(b.plot);
      const item = b.item;
      if (!plot || item.hp <= 0 || !plot.items.includes(item)) {
        this.burning.delete(id);
        continue;
      }
      if (now >= b.until) {
        this.out(id, now, false);
        continue;
      }
      if (now - b.since >= FIRE.douseDelay && this.waterFor(plot, item, now)) {
        this.out(id, now, true);
        continue;
      }
      const def = CATALOGUE[item.kind];
      this.host.scorch(plot, item, Math.max(FIRE.minBurn, def.health / FIRE.burnTime) * step);
      if (!this.burning.has(id) || now - b.since < FIRE.catchDelay) continue;
      if (shielded(plot, now)) continue;
      for (const o of plot.items) {
        if (o === item || !this.canCatch(o, now)) continue;
        if (Math.abs(o.x - item.x) > 40 || Math.abs(o.z - item.z) > 40) continue;
        const p = spreadChance(item, o, wind, step);
        if (p > 0 && this.host.rng() < p) this.ignite(plot, o, now);
      }
    }
  }
}
