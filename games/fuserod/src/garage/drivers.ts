import type { ModelId } from "./models.js";

function driver(id: number, name: string, rank: number, car: ModelId) {
  return { id, name, rank, car } as const;
}
// The first five entries are the original Fuse ladder. Persisted portrait IDs
// also identify the owner of a pink slip, so existing entries keep their index.
export const DRIVERS = [
  driver(0, "Finch", 0, "kestrel"),
  driver(1, "Pulse", 1, "marlin"),
  driver(2, "Sable", 2, "arrowhead"),
  driver(3, "Juno", 3, "meridian"),
  driver(4, "Redline", 4, "wildfire"),
  driver(5, "Patch", 0, "breaker"),
  driver(6, "Lark", 1, "jetstream"),
  driver(7, "Marlowe", 2, "switchback"),
  driver(8, "Torque", 3, "corsair"),
  driver(9, "Pepper", 0, "comet"),
  driver(10, "Calypso", 1, "sundial"),
  driver(11, "Flint", 2, "vesper"),
  driver(12, "Vega", 3, "northstar"),
  driver(13, "Linden", 0, "wren"),
  driver(14, "Echo", 1, "emberline"),
  driver(15, "Sparks", 2, "chicane"),
  driver(16, "Flare", 3, "meteor"),
  driver(17, "Rook", 0, "longshore"),
  driver(18, "Pearl", 1, "silverfin"),
  driver(19, "Keel", 2, "outrider"),
  driver(20, "Jet", 3, "caldera"),
  driver(21, "Scout", 0, "riptide"),
] as const;
const dinerTables = Array.from({ length: 5 }, (_, rank) =>
  DRIVERS.filter((d) => d.rank === rank),
);
export function dinerDriver(day: number, rank: number) {
  const table = dinerTables[rank]!;
  return table[Math.floor((day - 1) / 7) % table.length]!;
}
