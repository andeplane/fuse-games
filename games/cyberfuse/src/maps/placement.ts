import { PROP_DEFS, PICKUP_SPRITES, type Mission } from "../campaign/index.js";
import {
  COLORS,
  DOOR,
  FLOOR,
  ROOM,
  SIZE,
  WALL,
  access,
  at,
  tile,
  type Color,
  type DosRandom,
  type Geometry,
  type Point,
} from "./layout.js";

export interface PlacedProp extends Point {
  pixelX: number;
  pixelY: number;
  kind: string;
  objectIndex: number;
  hp: number;
  impassable: boolean;
  w: number;
  h: number;
  objectFlags: number;
}
export interface PlacedItem extends Point {
  kind: "core" | "reactor" | "hostage" | "medkit";
  objectiveIndex: number;
  sprite: number;
  hp: number;
  solid: boolean;
  objectFlags: number;
  pixelX: number;
  pixelY: number;
}
const NAMES = [
  "barrel2",
  "box",
  "box2",
  "cabinet",
  "plant",
  "table",
  "chair",
  "rod",
  "skullbarrel_wood",
  "barrel_wood",
  "graybox",
  "greenbox",
  "ogrestatue",
  "woodtable_candle",
  "woodtable",
  "tree",
  "bookshelf",
  "woodenbox",
  "clothedtable",
  "steeltable",
  "autumntree",
  "greentree",
  "box3",
  "safe",
  "redbox",
  "labtable",
  "terminal",
  "barrel",
  "rocket",
  "egg",
  "bloodstain",
  "wall_skull",
  "bone_n_blood",
  "bullet_marks",
  "skull",
  "blood",
  "scratch",
  "wall_stuff",
  "wall_goo",
  "goo",
];

/** SetupMap's object sampling, objective placement and reverse-order key distribution. */
export function placeObjects(map: Geometry, mission: Mission, rng: DosRandom) {
  const props: PlacedProp[] = [],
    items: PlacedItem[] = [],
    keys: (Point & { color: Color })[] = [];
  const objectives = mission.objectives.map((o) => ({ ...o }));
  const occupied = new Set<number>();
  const { cells, triggers } = map;
  const blocked = (i: number) => i < 0 || i >= cells.length || map.blocked(i);
  const available = (i: number) =>
    !blocked(i) && !triggers.has(i) && !occupied.has(i);
  const blockedOffsets = [
    1,
    -1,
    SIZE,
    -SIZE,
    SIZE + 1,
    SIZE - 1,
    -SIZE + 1,
    -SIZE - 1,
  ];
  function propAt(
    x: number,
    y: number,
    objectIndex: number,
  ): PlacedProp | undefined {
    const def = PROP_DEFS[objectIndex];
    if (!def) return;
    const f = def.flags,
      i = at(x, y),
      kind = tile(cells[i]!);
    if (
      !available(i) ||
      cells[i]! & 4096 ||
      (f & 16 && kind !== ROOM) ||
      (f & 32 && kind === ROOM) ||
      (f & 32768 && tile(cells[i - SIZE]!) !== WALL) ||
      (f & 64 && ![ROOM, FLOOR].includes(tile(cells[i + SIZE]!)))
    )
      return;
    const walls = blockedOffsets
      .slice(0, 4)
      .filter((d) => blocked(i + d)).length;
    if (
      (f & 128 && walls !== 1) ||
      (f & 256 && walls === 0) ||
      (f & 512 && blockedOffsets.some((d) => blocked(i + d)))
    )
      return;
    if (f & 64) cells[i] = cells[i]! | 4096;
    const pixelY = y * 12 + (f & 32768 ? -1 : 6);
    occupied.add(at(x, Math.floor(pixelY / 12)));
    return {
      x,
      y,
      pixelX: x * 16 + 8,
      pixelY,
      kind: NAMES[objectIndex]!,
      objectIndex,
      hp: def.hp,
      impassable: !!(f & 2),
      w: def.halfWidth,
      h: def.halfHeight,
      objectFlags: f,
    };
  }
  for (const item of mission.items) {
    const count = Math.floor((item.density * map.width * map.height) / 1000);
    for (let n = 0; n < count; n++) {
      const point = map.guess(),
        prop = propAt(point.x, point.y, item.index);
      if (prop) props.push(prop);
    }
  }
  const wallAt = (px: number, py: number) =>
    blocked(at(Math.floor(px / 16), Math.floor(py / 12)));
  for (const [objectiveIndex, o] of objectives.entries()) {
    if (o.kind !== "collect" && o.kind !== "destroy") continue;
    const high = !!(o.flags & 4) && map.accessCount > 1,
      low = !!(o.flags & 16);
    let placed = 0;
    for (let j = 0; j < o.count; j++) {
      for (let tries = 0; tries < (high || low ? 1000 : 100); tries++) {
        if (o.kind === "collect") {
          const px = (SIZE - map.width) * 8 + rng.next(map.width * 16),
            py = (SIZE - map.height) * 6 + rng.next(map.height * 12);
          const x = Math.floor(px / 16),
            y = Math.floor(py / 12),
            i = at(x, y),
            a = access(cells[i]!);
          if (
            (high && !a) ||
            (low && a) ||
            [-4, 0, 4].some((dx) =>
              [-3, 0, 3].some((dy) => wallAt(px + dx, py + dy)),
            )
          )
            continue;
          occupied.add(i);
          items.push({
            x,
            y,
            pixelX: px,
            pixelY: py,
            kind: "core",
            objectiveIndex,
            sprite: PICKUP_SPRITES[o.index % PICKUP_SPRITES.length]!.id,
            hp: 1,
            solid: false,
            objectFlags: 0,
          });
        } else {
          const { x, y } = map.guess(),
            flags = cells[at(x, y)]! >> 8;
          if ((high && !flags) || (low && flags)) continue;
          const prop = propAt(x, y, o.index % PROP_DEFS.length);
          if (!prop) continue;
          items.push({
            x,
            y,
            pixelX: prop.pixelX,
            pixelY: prop.pixelY,
            kind: "reactor",
            objectiveIndex,
            sprite: PROP_DEFS[prop.objectIndex]!.sprite.id,
            hp: prop.hp,
            solid: prop.impassable,
            objectFlags: prop.objectFlags,
          });
        }
        placed++;
        break;
      }
    }
    o.count = placed;
    o.required = Math.min(o.required, placed);
  }
  for (let level = map.accessCount - 1; level >= 1; level--) {
    const eligible = (x: number, y: number) => {
      const i = at(x, y);
      return (
        y < SIZE - 1 &&
        available(i) &&
        available(i + SIZE) &&
        tile(cells[i]!) === ROOM &&
        access(cells[i]!) === level - 1
      );
    };
    // DOS retries forever here. Use the same random draws, then a bounded deterministic scan.
    let p: Point | undefined;
    for (let n = 0; n < 16384; n++) {
      const v = map.guess();
      if (eligible(v.x, v.y)) {
        p = v;
        break;
      }
    }
    if (!p) {
      for (let i = 0; i < cells.length; i++)
        if (eligible(i % SIZE, Math.floor(i / SIZE))) {
          p = { x: i % SIZE, y: Math.floor(i / SIZE) };
          break;
        }
    }
    if (!p) {
      // Extremely crowded room: allow an occupied approach, preserving the ordered key chain.
      const i = cells.findIndex(
        (cell, index) =>
          tile(cell) === ROOM &&
          access(cell) === level - 1 &&
          !occupied.has(index),
      );
      if (i >= 0) p = { x: i % SIZE, y: Math.floor(i / SIZE) };
    }
    if (p) {
      keys.push({ ...p, color: COLORS[level - 1]! });
      occupied.add(at(p.x, p.y));
    } else
      for (const door of map.doors)
        if (door.key === COLORS[level - 1]) door.key = null;
  }
  return { props, items, keys, objectives };
}
export function rows<T>(
  values: ArrayLike<T>,
  glyph: (v: T, i: number) => string,
): string[] {
  return Array.from({ length: SIZE }, (_, y) =>
    Array.from({ length: SIZE }, (_, x) => {
      const i = at(x, y);
      return glyph(values[i]!, i);
    }).join(""),
  );
}
export function terrain(map: Geometry) {
  const { left, right, top, bottom } = map.exit;
  return rows(map.cells, (cell, i) => {
    const x = i % SIZE,
      y = Math.floor(i / SIZE);
    if (tile(cell) === DOOR) return "D";
    if (map.blocked(i)) return "#";
    return x >= left && x < right && y >= top && y < bottom ? "E" : ".";
  });
}
