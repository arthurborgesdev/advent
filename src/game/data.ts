import type { InventoryItem, Recipe } from "./protocol";

export const ITEM_LABELS: Record<InventoryItem, string> = {
  wood: "Wood",
  ore: "Ore",
  essence: "Essence",
  potion: "Potion",
  ether: "Ether",
};

export const RECIPES: Recipe[] = [
  {
    id: "potion",
    name: "Potion",
    description: "Restore 35 HP.",
    cost: { wood: 1, essence: 1 },
    output: { itemId: "potion" },
  },
  {
    id: "ether",
    name: "Ether",
    description: "Restore 25 mana.",
    cost: { ore: 1, essence: 1 },
    output: { itemId: "ether" },
  },
  {
    id: "iron-edge",
    name: "Iron Edge",
    description: "Upgrade sword damage.",
    cost: { wood: 2, ore: 3, essence: 2 },
    output: { weaponTier: 2 },
  },
  {
    id: "void-edge",
    name: "Void Edge",
    description: "Upgrade sword again.",
    cost: { wood: 4, ore: 5, essence: 5 },
    output: { weaponTier: 3 },
  },
];
