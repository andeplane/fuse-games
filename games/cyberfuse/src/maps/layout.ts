/** DOS C-Dogs 1.06 map format and procedural layout, after Ronny Wester's MAP.C and MISSION.C. */
export const SIZE = 64;
export type Color = "yellow" | "green" | "blue" | "red";
export interface Point {
  x: number;
  y: number;
}
export interface Bounds {
  left: number;
  top: number;
  right: number;
  bottom: number;
}
export interface LayoutOptions {
  width: number;
  height: number;
  walls: number;
  wallLength: number;
  rooms: number;
  squares: number;
  exit: Bounds | null;
}

/** Watcom's 32-bit random sequence. The seed is distinct from the 15-bit value returned to the game. */
export class DosRandom {
  constructor(public state: number) {}
  next(limit: number) {
    this.state = (Math.imul(this.state, 1103515245) + 12345) >>> 0;
    return ((this.state >>> 16) & 32767) % limit;
  }
}
export const FLOOR = 0,
  WALL = 1,
  DOOR = 2,
  ROOM = 3,
  SQUARE = 4,
  OUTSIDE = 6;
export const KEY_BITS = [0, 2048, 1024, 512, 256] as const;
export const COLORS: readonly Color[] = ["yellow", "green", "blue", "red"];
export const at = (x: number, y: number) => y * SIZE + x;
export const tile = (cell: number) => cell & 255;
export const access = (cell: number) =>
  KEY_BITS.findIndex((bits) => (cell & 3840) === bits);
const directions = [
  [0, -1],
  [1, 0],
  [0, 1],
] as const;

export function geometry(config: LayoutOptions, rng: DosRandom) {
  const width = config.width || SIZE,
    height = config.height || SIZE;
  const left = (SIZE - width) >> 1,
    top = (SIZE - height) >> 1;
  const cells = new Uint16Array(SIZE * SIZE);
  const guess = (): Point => ({
    x: left + rng.next(width),
    y: top + rng.next(height),
  });
  const exit =
    config.exit && config.exit.left > 0
      ? { ...config.exit }
      : (() => {
          const x = left + rng.next(width - 8),
            y = top + rng.next(height - 8);
          return { left: x, top: y, right: x + 9, bottom: y + 9 };
        })();
  for (let y = 0; y < SIZE; y++)
    for (let x = 0; x < SIZE; x++) {
      const dx = Math.min(x, SIZE - 1 - x),
        dy = Math.min(y, SIZE - 1 - y);
      cells[at(x, y)] =
        dx < left || dy < top
          ? OUTSIDE
          : dx === left || dy === top
            ? WALL
            : FLOOR;
    }

  function clear(x: number, y: number, w: number, h: number) {
    if (x < 0 || y < 0 || x + w >= SIZE || y + h >= SIZE) return false;
    for (let row = y; row <= y + h; row++)
      for (let col = x; col <= x + w; col++)
        if (cells[at(col, row)] !== FLOOR) return false;
    return true;
  }
  const fill = (x: number, y: number, w: number, h: number, value: number) => {
    for (let row = y; row <= y + h; row++)
      cells.fill(value, at(x, row), at(x + w, row) + 1);
  };
  function generate(count: number, attempt: () => boolean) {
    for (let i = 0; i < 1000 && count > 0; i++) if (attempt()) count--;
  }
  generate(config.squares, () => {
    const { x, y } = guess(),
      w = 7 + rng.next(9),
      h = 7 + rng.next(9);
    if (!clear(x - 1, y - 1, w + 2, h + 2)) return false;
    fill(x, y, w, h, SQUARE);
    return true;
  });
  let accessCount = 0;
  generate(config.rooms, () => {
    const { x, y } = guess(),
      w = 5 + rng.next(6),
      h = 5 + rng.next(6);
    if (!clear(x - 1, y - 1, w + 2, h + 2)) return false;
    const roll = rng.next(20);
    const level = Math.min(
      accessCount,
      roll === 0 ? 4 : roll < 3 ? 3 : roll < 6 ? 2 : roll < 10 ? 1 : 0,
    );
    accessCount = Math.max(accessCount, level + 1);
    fill(x, y, w, h, WALL);
    fill(x + 1, y + 1, w - 2, h - 2, ROOM | KEY_BITS[level]!);
    const doors = 1 + rng.next(15),
      midX = x + (w >> 1),
      midY = y + (h >> 1);
    if (doors & 1) cells[at(x, midY)] = DOOR;
    if (doors & 2) cells[at(x + w, midY)] = DOOR;
    if (doors & 4) cells[at(midX, y)] = DOOR;
    if (doors & 8) cells[at(midX, y + h)] = DOOR;
    return true;
  });
  function grow(x: number, y: number, dir: number, length: number) {
    // DOS Grow's west case is numbered 4, although all callers choose 0..3.
    // Direction 3 consumes branch rolls and wall length without moving.
    const step = directions[dir];
    while (length > 0) {
      if (step) {
        const [dx, dy] = step,
          nx = x + dx,
          ny = y + dy;
        if (
          nx < 1 ||
          nx >= SIZE - 1 ||
          ny < 1 ||
          ny >= SIZE - 1 ||
          (dy < 0 && y < 3) ||
          (dx > 0 && x > SIZE - 3) ||
          (dy > 0 && y > SIZE - 3) ||
          cells[at(nx + dy, ny + dx)] !== FLOOR ||
          cells[at(nx - dy, ny - dx)] !== FLOOR ||
          cells[at(nx + dx, ny + dy)] !== FLOOR ||
          cells[at(nx + dx + dy, ny + dy + dx)] !== FLOOR ||
          cells[at(nx + dx - dy, ny + dy - dx)] !== FLOOR
        )
          return;
        x = nx;
        y = ny;
      }
      cells[at(x, y)] = WALL;
      length--;
      if (length && rng.next(4) === 0) {
        const branch = rng.next(length);
        grow(x, y, rng.next(4), branch);
        length -= branch;
      }
    }
  }
  generate(config.walls, () => {
    const { x, y } = guess();
    if (
      x !== 0 &&
      y !== 0 &&
      x !== SIZE - 1 &&
      y !== SIZE - 1 &&
      !clear(x - 1, y - 1, 2, 2)
    )
      return false;
    cells[at(x, y)] = WALL;
    grow(x, y, rng.next(4), config.wallLength);
    return true;
  });

  const decor = Array<string>(SIZE * SIZE);
  const blocked = (i: number) =>
    cells[i] === WALL || cells[i] === OUTSIDE || cells[i] === DOOR;
  for (let i = 0; i < cells.length; i++) {
    const type = tile(cells[i]!);
    decor[i] =
      type === OUTSIDE ? " " : type === ROOM || type === DOOR ? "r" : ".";
  }
  for (const [count, mark] of [
    [50, "d"],
    [100, "1"],
    [150, "2"],
  ] as const) {
    for (let i = 0; i < count; i++) {
      let x = rng.next(SIZE),
        y = rng.next(SIZE);
      if (mark === "d") {
        x &= ~1;
        y &= ~1;
      }
      const index = at(x, y),
        cell = cells[index];
      if (
        (cell === FLOOR || cell === SQUARE) &&
        decor[index] === "." &&
        cells[index - SIZE] !== WALL &&
        cells[index - SIZE] !== OUTSIDE
      )
        decor[index] = mark;
    }
  }
  const doors: (Point & { key: Color | null; horizontal: boolean })[] = [];
  const triggers = new Set<number>();
  for (let x = 1; x < SIZE - 1; x++)
    for (let y = 1; y < SIZE - 1; y++) {
      const i = at(x, y);
      if (cells[i] !== DOOR) continue;
      const horizontal = cells[i - 1] === WALL;
      const level = [i - 1, i + 1, i - SIZE, i + SIZE]
        .map((n) => access(cells[n]!))
        .find((n) => n > 0);
      doors.push({ x, y, horizontal, key: level ? COLORS[level - 1]! : null });
      const offset = horizontal ? SIZE : 1;
      triggers.add(i - offset);
      triggers.add(i + offset);
    }
  return {
    cells,
    decor,
    doors,
    triggers,
    exit,
    width,
    height,
    left,
    top,
    accessCount,
    blocked,
    guess,
  };
}
export type Geometry = ReturnType<typeof geometry>;
