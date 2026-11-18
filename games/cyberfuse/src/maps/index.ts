import { CAPACITY } from "../capacity.js";
import {
  DOGFIGHTS,
  getCampaignForMission,
  getMission,
  type Character,
  type Mission,
} from "../campaign/index.js";
import {
  DosRandom,
  FLOOR,
  SIZE,
  access,
  at,
  geometry,
  type Geometry,
  type Point,
} from "./layout.js";
import { placeObjects, rows, terrain } from "./placement.js";
import { enemyCount } from "../options/index.js";

export { DosRandom, geometry } from "./layout.js";
export type { Bounds, Color, Point } from "./layout.js";

interface Spawn extends Point {
  pixelX: number;
  pixelY: number;
}
interface Enemy extends Spawn, Character {
  characterIndex: number;
  role: "guard" | "scout" | "heavy";
  weapon: number;
  objectiveIndex?: number;
}

/** Actor spawn positions are sampled after the original DOS game reseeds from its clock.
 * Fuse derives this second stream from the match seed so a replay can rebuild the initial world.
 * Tile indices and the precise pixel placement are both retained. */
function placeActors(
  map: Geometry,
  objects: ReturnType<typeof placeObjects>,
  mission: Mission,
  characters: Character[],
  rng: DosRandom,
  dogfight: boolean,
  seatCount: number,
  density: number,
) {
  const taken = objects.props
    .filter((p) => p.impassable)
    .map((p) => ({ x: p.pixelX, y: p.pixelY, w: p.w, h: p.h }));
  for (const item of objects.items)
    if (item.solid) taken.push({ x: item.pixelX, y: item.pixelY, w: 8, h: 6 });
  const spawns: Spawn[] = [],
    enemies: Enemy[] = [];
  function spawn(accept: (x: number, y: number) => boolean): Spawn {
    function sample(
      px: number,
      py: number,
      check: (x: number, y: number) => boolean,
    ) {
      const x = Math.floor(px / 16),
        y = Math.floor(py / 12);
      if (!check(x, y)) return;
      for (const dx of [-7, 0, 7])
        for (const dy of [-5, 0, 5]) {
          const tx = Math.floor((px + dx) / 16),
            ty = Math.floor((py + dy) / 12);
          if (
            tx < 0 ||
            ty < 0 ||
            tx >= SIZE ||
            ty >= SIZE ||
            map.blocked(at(tx, ty))
          )
            return;
        }
      if (
        taken.some(
          (p) => Math.abs(p.x - px) < p.w + 7 && Math.abs(p.y - py) < p.h + 5,
        )
      )
        return;
      taken.push({ x: px, y: py, w: 7, h: 5 });
      return { x, y, pixelX: px, pixelY: py };
    }
    for (let n = 0; n < 4096; n++) {
      const p = sample(rng.next(1024), rng.next(768), accept);
      if (p) return p;
    }
    for (const check of [accept, () => true])
      for (let i = 0; i < SIZE * SIZE; i++) {
        const p = sample(
          (i % SIZE) * 16 + 8,
          Math.floor(i / SIZE) * 12 + 6,
          check,
        );
        if (p) return p;
      }
    throw new RangeError("Mission has no free actor spawn");
  }
  function enemy(indices: number[], objectiveIndex?: number) {
    if (!indices.length || !characters.length) return false;
    const characterIndex =
      indices[rng.next(indices.length)]! % characters.length;
    const c = characters[characterIndex]!;
    const point = spawn((x, y) =>
      spawns
        .slice(0, 2)
        .every(
          (p) =>
            Math.max(Math.abs(p.x - x) * 16, Math.abs(p.y - y) * 12) >= 150,
        ),
    );
    enemies.push({
      ...point,
      ...c,
      weapon: c.gun,
      role: c.hp >= 100 ? "heavy" : c.speed > 256 ? "scout" : "guard",
      characterIndex,
      ...(objectiveIndex === undefined ? {} : { objectiveIndex }),
    });
    return true;
  }
  let prisoner = false;
  for (const [index, o] of objects.objectives.entries()) {
    if (o.kind === "kill") {
      let placed = 0;
      for (let j = 0; j < o.count; j++)
        if (enemy(mission.specials, index)) placed++;
      o.count = placed;
      o.required = Math.min(o.required, placed);
    }
    if (o.kind === "rescue") {
      o.required = o.count = prisoner ? 0 : 1;
      if (prisoner) continue;
      prisoner = true;
      const p = spawn(
        (x, y) => map.accessCount <= 1 || access(map.cells[at(x, y)]!) > 0,
      );
      const c = characters[o.index % characters.length];
      objects.items.push({
        ...p,
        kind: "hostage",
        hp: c?.hp ?? 40,
        objectiveIndex: index,
        sprite: c?.face ?? 0,
        solid: false,
        objectFlags: 0,
      });
    }
  }
  for (let n = 0; n < seatCount; n++)
    spawns.push(spawn((x, y) => map.cells[at(x, y)] === FLOOR));
  if (!dogfight && mission.enemies.length)
    for (let n = 0; n < enemyCount(mission.enemyDensity, density); n++)
      enemy(mission.enemies);
  return { spawns, enemies };
}

export function buildMission(
  missionIndex: number,
  seed: number,
  dogfight = false,
  campaign?: number,
  layoutSeed = 0,
  seatCount: number = CAPACITY,
  density = 100,
) {
  if (!Number.isInteger(seatCount) || seatCount < 1 || seatCount > CAPACITY)
    throw new RangeError(`Expected 1–${CAPACITY} operators`);
  const owner = dogfight
    ? undefined
    : getCampaignForMission(missionIndex, campaign);
  const mission = dogfight
    ? DOGFIGHTS[missionIndex % DOGFIGHTS.length]!
    : getMission(missionIndex, campaign);
  const localIndex = owner?.missions.indexOf(mission) ?? 0;
  const rng = new DosRandom(layoutSeed + localIndex * 10);
  const map = geometry(mission, rng);
  const objects = placeObjects(map, mission, rng);
  const actorStream = new DosRandom((seed ^ 0xa5264e17 ^ localIndex) >>> 0);
  const actors = placeActors(
    map,
    objects,
    mission,
    owner?.characters ?? [],
    actorStream,
    dogfight,
    seatCount,
    density,
  );
  return {
    ...actors,
    ...objects,
    tiles: terrain(map),
    decor: rows(map.decor, (v) => v),
    doors: map.doors,
    exit: map.exit,
    left: map.left,
    top: map.top,
    width: map.width,
    height: map.height,
  };
}
