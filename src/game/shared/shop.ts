import { type KitId, type ToolKind, TOOLS } from "./items";

/*
 * The keeper's stall by the lighthouse. Coins only come from bounties, and
 * this is the only place to spend them.
 */

export type ShopSection = "Shelter" | "Amenities" | "Gear" | "Vehicles";

export type ShopEntry = {
  id: string;
  section: ShopSection;
  price: number;
  give: { kit: KitId } | { tool: ToolKind };
};

const CATALOG: readonly ShopEntry[] = [
  { id: "hut", section: "Shelter", price: 120, give: { kit: "hut" } },
  { id: "cabin", section: "Shelter", price: 320, give: { kit: "cabin" } },
  { id: "campfire", section: "Amenities", price: 25, give: { kit: "campfire" } },
  { id: "chest", section: "Amenities", price: 40, give: { kit: "chest" } },
  { id: "bed", section: "Amenities", price: 60, give: { kit: "bed" } },
  { id: "dock", section: "Amenities", price: 150, give: { kit: "dock" } },
  { id: "rod2", section: "Gear", price: 90, give: { tool: "rod2" } },
  { id: "rowboat", section: "Vehicles", price: 220, give: { kit: "rowboat" } },
];

/* What's for sale here. Weapons come from the marketplace instead. */
export const SHOP: readonly ShopEntry[] = CATALOG.filter(
  (e) => !("tool" in e.give) || !TOOLS[e.give.tool].weapon,
);

/* How close to the stall you need to be to trade. */
export const SHOP_REACH = 6;

export const shopEntry = (id: unknown) => SHOP.find((e) => e.id === id) ?? null;
