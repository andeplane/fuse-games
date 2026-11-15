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

/** Fixed-size cave, with a connected central gallery, shafts and firing ledges. */
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
  // Keep useful cover while guaranteeing every spawn connects to every other.
  for (let x = 4; x < COLS - 4; x += 3)
    carve(x, 55 + Math.round((random(state) - 0.5) * 4), 10, 13);
  for (let x = 14; x < COLS - 10; x += 35) {
    for (let y = 25; y < 82; y += 4) carve(x, y, 9, 10);
    carve(x, 28, 17, 11);
    carve(x + 13, 82, 20, 10);
  }
  for (let i = 0; i < 11; i++)
    carve(
      12 + random(state) * (COLS - 24),
      23 + random(state) * 64,
      8 + random(state) * 10,
      5 + random(state) * 7,
    );
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
  const wanted = 60 + slot * 160;
  // Search in a stable order near this seat's own cave. Respawns never overwrite terrain.
  for (let offset = 0; offset < COLS; offset++) {
    const x = clamp(
      wanted + (offset % 2 === 0 ? 1 : -1) * Math.ceil(offset / 2) * CELL,
      16,
      WIDTH - 16,
    );
    for (let y = 216; y < HEIGHT - 16; y += CELL)
      if (!blocked(world, x, y) && blocked(world, x, y + CELL)) return { x, y };
  }
  for (let y = 16; y < HEIGHT - 16; y += CELL)
    for (let x = 16; x < WIDTH - 16; x += CELL)
      if (!blocked(world, x, y)) return { x, y };
  return { x: 60, y: 216 };
}
