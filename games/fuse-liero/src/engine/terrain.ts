import {
  CELL,
  COLS,
  ROWS,
  WIDTH,
  HEIGHT,
  random,
  clamp,
  type World,
} from "./types.js";

const GALLERIES = [0.16, 0.38, 0.61, 0.84] as const;
const SHAFTS = [0.1, 0.3, 0.5, 0.7, 0.9] as const;

/** A connected cave across the full world, with four galleries and climbable shafts. */
export function createTerrain(seed: number): string[] {
  const state = { rng: seed };
  const rows: string[][] = Array.from({ length: ROWS }, (_, y) =>
    Array.from({ length: COLS }, (_, x) =>
      x < 2 || x >= COLS - 2 || y < 2 || y >= ROWS - 2 ? "2" : "1",
    ),
  );
  const carve = (cx: number, cy: number, rx: number, ry: number) => {
    for (
      let y = Math.max(2, Math.floor(cy - ry));
      y <= Math.min(ROWS - 3, cy + ry);
      y++
    )
      for (
        let x = Math.max(2, Math.floor(cx - rx));
        x <= Math.min(COLS - 3, cx + rx);
        x++
      )
        if (((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1) rows[y]![x] = "0";
  };
  // Small, interpolated bends preserve the original passage and jump dimensions.
  for (const depth of GALLERIES) {
    let from = Math.round((random(state) - 0.5) * 10);
    let to = Math.round((random(state) - 0.5) * 10);
    for (let x = 5; x < COLS - 4; x += 2) {
      if ((x - 5) % 32 === 0) {
        from = to;
        to = Math.round((random(state) - 0.5) * 10);
      }
      const bend = from + (to - from) * (((x - 5) % 32) / 32);
      carve(x, Math.round(ROWS * depth + bend), 9, 10);
    }
  }
  for (const across of SHAFTS) {
    const x = Math.round(COLS * across);
    const top = Math.round(ROWS * GALLERIES[0]);
    const bottom = Math.round(ROWS * GALLERIES[3]);
    for (let y = top; y <= bottom; y += 2) carve(x, y, 8, 7);
    for (const depth of GALLERIES) carve(x, Math.round(ROWS * depth), 17, 13);
    // Staggered shelves every 40px make the shafts traversable with unchanged jumps.
    // Each shelf leaves most of the shaft open, so worms can jump around its edge.
    for (let y = top + 10, shelf = 0; y < bottom - 5; y += 10, shelf++) {
      const side = shelf % 2 === 0 ? -1 : 1;
      for (let dx = 2; dx <= 6; dx++)
        for (let dy = 0; dy < 2; dy++) rows[y + dy]![x + dx * side] = "1";
    }
  }
  return rows.map((row) => row.join(""));
}

export function material(
  world: Pick<World, "terrain">,
  x: number,
  y: number,
): string {
  if (x < 0 || y < 0 || x >= WIDTH || y >= HEIGHT) return "2";
  return world.terrain[Math.floor(y / CELL)]?.[Math.floor(x / CELL)] ?? "2";
}
export const solid = (
  world: Pick<World, "terrain">,
  x: number,
  y: number,
): boolean => material(world, x, y) !== "0";
export function blocked(
  world: Pick<World, "terrain">,
  x: number,
  y: number,
): boolean {
  return (
    solid(world, x - 4, y - 4) ||
    solid(world, x + 4, y - 4) ||
    solid(world, x - 4, y + 4) ||
    solid(world, x + 4, y + 4) ||
    solid(world, x, y)
  );
}
/** Craters are part of checkpoint state, including a mid-flight rollback's previous cave. */
export function destroyTerrain(
  world: World,
  cx: number,
  cy: number,
  radius: number,
): void {
  const first = clamp(Math.floor((cy - radius) / CELL), 0, ROWS - 1);
  const last = clamp(Math.floor((cy + radius) / CELL), 0, ROWS - 1);
  for (let y = first; y <= last; y++) {
    let row = world.terrain[y]!;
    const from = clamp(Math.floor((cx - radius) / CELL), 0, COLS - 1);
    const to = clamp(Math.floor((cx + radius) / CELL), 0, COLS - 1);
    const cells = row.split("");
    let changed = false;
    for (let x = from; x <= to; x++)
      if (
        cells[x] === "1" &&
        (x * CELL + CELL / 2 - cx) ** 2 + (y * CELL + CELL / 2 - cy) ** 2 <=
          radius ** 2
      ) {
        cells[x] = "0";
        changed = true;
      }
    if (changed) {
      row = cells.join("");
      world.terrain[y] = row;
    }
  }
}
export function spawnPoint(
  world: Pick<World, "terrain">,
  slot: number,
): { x: number; y: number } {
  const home = clamp(slot, 0, SHAFTS.length - 1);
  const cx = Math.round(COLS * SHAFTS[home]!);
  const cy = Math.round(ROWS * GALLERIES[[0, 2, 1, 3, 1][home]!]!);
  const candidate = (
    dx: number,
    dy: number,
  ): { x: number; y: number } | undefined => {
    const x = (cx + dx) * CELL;
    const y = (cy + dy) * CELL;
    if (x < 16 || y < 16 || x >= WIDTH - 16 || y >= HEIGHT - 16) return;
    return !blocked(world, x, y) && blocked(world, x, y + CELL)
      ? { x, y }
      : undefined;
  };
  // Expanding rings stay close to each slot's distinct home on both axes.
  // The same stable search handles craters on respawn without changing terrain.
  for (let radius = 0; radius < Math.max(COLS, ROWS); radius++) {
    for (let dx = -radius; dx <= radius; dx++) {
      const above = candidate(dx, -radius);
      if (above) return above;
      const below = candidate(dx, radius);
      if (below) return below;
    }
    for (let dy = -radius + 1; dy < radius; dy++) {
      const left = candidate(-radius, dy);
      if (left) return left;
      const right = candidate(radius, dy);
      if (right) return right;
    }
  }
  for (let y = 16; y < HEIGHT - 16; y += CELL)
    for (let x = 16; x < WIDTH - 16; x += CELL)
      if (!blocked(world, x, y)) return { x, y };
  return { x: cx * CELL, y: cy * CELL };
}
