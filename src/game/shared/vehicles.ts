/*
 * Things to ride, chosen from the marketplace. Spawning one puts it in the
 * water near you; you get one at a time, and a new one replaces the last.
 * Everything is free for now; `price` is what it will cost once the market
 * takes coins.
 */

export type VehicleKind = "rowboat";

/* In marketplace order. */
export const VEHICLE_KINDS: readonly VehicleKind[] = ["rowboat"];

export const isVehicleKind = (v: unknown): v is VehicleKind =>
  typeof v === "string" && (VEHICLE_KINDS as readonly string[]).includes(v);

export type VehicleDef = {
  name: string;
  price: number;
  /* What it's like to ride, in a line. */
  hint: string;
};

export const VEHICLES: Record<VehicleKind, VehicleDef> = {
  rowboat: {
    name: "Rowboat",
    price: 220,
    hint: "Seats one · W and S pull on the oars, A and D turn",
  },
};
