import type { GameMap } from "./map.js";
import { ceilDiv, div } from "./math.js";
import { TILE } from "./tuning.js";

interface Point {
  x: number;
  y: number;
}

export type VisitNearby<Value> = (
  point: Point,
  range: number,
  visit: (entry: Value) => void,
) => void;

/** Index positions at phase start, with row-first cells and source order inside each cell. */
export function spatialGrid<Entry extends Point, Value>(
  map: Pick<GameMap, "width" | "height">,
  entries: readonly Entry[],
  cellSize: number,
  value: (entry: Entry, index: number) => Value,
): VisitNearby<Value> {
  const columns = ceilDiv(map.width * TILE, cellSize);
  const rows = ceilDiv(map.height * TILE, cellSize);
  const cells = new Map<number, Value[]>();
  const empty: readonly Value[] = [];
  for (const [index, entry] of entries.entries()) {
    const key = div(entry.y, cellSize) * columns + div(entry.x, cellSize);
    const cell = cells.get(key);
    const item = value(entry, index);
    if (cell) cell.push(item);
    else cells.set(key, [item]);
  }
  return (point, range, visit) => {
    const left = Math.max(0, div(point.x - range, cellSize));
    const right = Math.min(columns - 1, div(point.x + range, cellSize));
    const top = Math.max(0, div(point.y - range, cellSize));
    const bottom = Math.min(rows - 1, div(point.y + range, cellSize));
    for (let y = top; y <= bottom; y++)
      for (let x = left; x <= right; x++)
        for (const item of cells.get(y * columns + x) ?? empty) visit(item);
  };
}
