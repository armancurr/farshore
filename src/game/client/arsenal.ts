import { ownsVehicle, VEHICLE_KINDS, type VehicleKind } from "../shared/vehicles";
import { isThrown, toWeaponKind, type WeaponKind } from "../shared/weapons";

/*
 * Your arsenal: the weapons and vehicles you've got from the marketplace,
 * and the coins to get more. Each is got once and kept; after that it's on
 * the Arsenal wheel (Q), ready to hold or spawn.
 *
 * Vehicles cost coins, so the room keeps those, in your inventory, along
 * with your purse: what's here is its latest word (see `setPurse`). Weapons
 * are still free, so this browser keeps that list, as it keeps your skin.
 */

export type Arsenal = {
  weapons: readonly WeaponKind[];
  /* The free tier and everything you've bought, in marketplace order. */
  vehicles: readonly VehicleKind[];
  coins: number;
};

const KEY = "farshore:arsenal";

/* The vehicles a purse holds: the free tier, and what's been bought. */
const vehiclesOf = (bought: readonly VehicleKind[]) =>
  VEHICLE_KINDS.filter((k) => ownsVehicle(bought, k));

function load(): Arsenal {
  const vehicles = vehiclesOf([]);
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const saved = JSON.parse(raw) as { weapons?: unknown };
      const weapons = Array.isArray(saved.weapons)
        ? saved.weapons.map(toWeaponKind).filter((k): k is WeaponKind => !!k && !isThrown(k))
        : [];
      return { weapons: [...new Set(weapons)], vehicles, coins: 0 };
    }
  } catch {
    /* Storage unavailable or damaged: start again. */
  }
  /*
   * From before the arsenal: the weapon this browser carried is already yours.
   * (Read here rather than through net.ts, which would pull the room into the page.)
   */
  let carried: WeaponKind | null = null;
  try {
    carried = toWeaponKind(localStorage.getItem("farshore:weapon"));
  } catch {
    /* Storage unavailable. */
  }
  return { weapons: carried && !isThrown(carried) ? [carried] : [], vehicles, coins: 0 };
}

let arsenal: Arsenal | null = null;
const listeners = new Set<() => void>();

/* What you own right now. The same object until something changes, so React can watch it. */
export function getArsenal(): Arsenal {
  arsenal ??= load();
  return arsenal;
}

export function subscribeArsenal(fn: () => void) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

function save(next: Arsenal) {
  set(next);
  try {
    localStorage.setItem(KEY, JSON.stringify({ weapons: next.weapons }));
  } catch {
    /* Storage unavailable: it lasts until the tab closes. */
  }
}

function set(next: Arsenal) {
  arsenal = next;
  for (const fn of listeners) fn();
}

/* The room's word on your coins and the vehicles you've bought (an empty purse when out of the world). */
export function setPurse(coins: number, bought: readonly VehicleKind[]) {
  const now = getArsenal();
  const vehicles = vehiclesOf(bought);
  if (now.coins === coins && vehicles.join() === now.vehicles.join()) return;
  set({ ...now, coins, vehicles });
}

export const ownsWeapon = (kind: WeaponKind) => getArsenal().weapons.includes(kind);

/* Into the arsenal, in the order it was got. Kegs and smoke bombs are bought one by one instead, onto the belt. */
export function getWeapon(kind: WeaponKind) {
  if (isThrown(kind)) return;
  const now = getArsenal();
  if (!now.weapons.includes(kind)) save({ ...now, weapons: [...now.weapons, kind] });
}
