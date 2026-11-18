import campaign from "./campaign.json" with { type: "json" };

export type LevelPack = keyof typeof campaign;
export const COLUMNS = 20;
export const ROWS = 30;
export const TILE_WIDTH = 32;
export const TILE_HEIGHT = 16;
export const FLOOR_ROW = 26;

export interface SpawnPoint {
  readonly x: number;
  readonly y: number;
}

export interface PestSpawn {
  readonly type: number;
  readonly temper: number;
  readonly speed: number;
  readonly points: number;
  readonly spacing: number;
  readonly left: SpawnPoint;
  readonly right: SpawnPoint;
}

export interface FuseLevel {
  readonly name: string;
  readonly mapId: number;
  readonly stage: number;
  readonly backgroundId: number;
  readonly platformId: number;
  /** One tile per cell, in screen row order. */
  readonly tiles: readonly number[];
  /** Top-left sprite origins, in original 640×480 screen coordinates. */
  readonly spawns: readonly [SpawnPoint, SpawnPoint];
  readonly pests: readonly PestSpawn[];
  readonly physics: {
    readonly gravity: number;
    readonly friction: number;
    readonly jump: number;
    readonly maxSpeed: number;
    readonly acceleration: number;
    readonly springJump: number;
  };
  readonly boss?: {
    readonly type: number;
    readonly spriteId: number;
    readonly x: number;
    readonly y: number;
    readonly hp: number;
    readonly difficulty: number;
    readonly fields: readonly number[];
  };
}

function readPests(encoded: string): PestSpawn[] {
  const bytes = Uint8Array.from(atob(encoded), (c) => c.charCodeAt(0));
  const table = new DataView(bytes.buffer);
  const pests: PestSpawn[] = [];
  for (let offset = 0; offset < bytes.length; offset += 26) {
    const word = (index: number) => table.getInt16(offset + index * 2, false);
    pests.push({
      type: word(0),
      temper: word(1),
      speed: word(3),
      points: word(7),
      spacing: word(8),
      left: { x: word(9), y: word(11) },
      right: { x: word(10), y: word(12) },
    });
  }
  return pests;
}

const decoded: Record<LevelPack, Map<number, FuseLevel>> = {
  original: new Map(),
  bonus: new Map(),
};

export function levelCount(pack: LevelPack = "original"): number {
  return campaign[pack].length;
}

/** One-based campaign index. The normal campaign ends with the six-ruler gauntlet and Grand Finale. */
export function getLevel(
  round: number,
  pack: LevelPack = "original",
): FuseLevel {
  const cached = decoded[pack].get(round);
  if (cached) return cached;
  const data = campaign[pack][round - 1];
  if (!data) throw new RangeError(`Unknown ${pack} round ${round}`);
  const start = data.starts;
  const env = data.environment;
  const boss = data.boss;
  const level: FuseLevel = {
    name: data.name,
    mapId: data.mapId,
    stage: data.stage,
    backgroundId: data.backgroundId,
    platformId: data.platformId,
    // MapSetup copies all cells and then fills the four rows below the playable area.
    tiles: Array.from(data.tiles, (code, i) =>
      i >= FLOOR_ROW * COLUMNS ? 2 : code.charCodeAt(0) - 65,
    ),
    spawns: [
      { x: start[0]!, y: start[1]! },
      { x: start[2]!, y: start[3]! },
    ],
    physics: {
      gravity: env[0]!,
      friction: env[1]!,
      jump: env[2]!,
      maxSpeed: env[3]!,
      acceleration: env[4]!,
      springJump: env[5]!,
    },
    pests: readPests(data.pests),
    ...(boss.length
      ? {
          boss: {
            type: boss[1]!,
            spriteId: boss[0]!,
            x: boss[2]!,
            y: boss[3]!,
            hp: boss[4]!,
            difficulty: boss[5]!,
            fields: boss,
          },
        }
      : {}),
  };
  decoded[pack].set(round, level);
  return level;
}

export function tileAt(level: FuseLevel, column: number, row: number): number {
  if (column < 0 || column >= COLUMNS || row < 0 || row >= ROWS) return 0;
  return level.tiles[row * COLUMNS + column] ?? 0;
}
