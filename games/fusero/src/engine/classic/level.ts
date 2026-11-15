/*
 * OpenLieroX default level physical data — altered TypeScript adapter for Fusero.
 * Source: openlierox/openlierox 0a20c6d0a10ed63b28a15f05c771913c294efbf6.
 * Retain the upstream license notices distributed with this port.
 */
import { CLASSIC_LEVEL_DATA } from "./level-data.js";
import { CASTLE_STRIKE_LEVEL_DATA } from "./level-castle-strike.js";
import { FACTORY_LEVEL_DATA } from "./level-factory.js";
import { JAIL_BREAK_LEVEL_DATA } from "./level-jail-break.js";
import type { PixelTerrain } from "./terrain-types.js";
import type { ClassicLevelId } from "./level-types.js";
export type { ClassicLevelId } from "./level-types.js";

export interface ClassicLevelData {
  readonly sourcePath: string;
  readonly sourceSha256: string;
  readonly flagsSha256: string;
  readonly materialSha256: string;
  readonly name: string;
  readonly theme: string;
  readonly width: number;
  readonly height: number;
  readonly compressedBytes: number;
  readonly inflatedBytes: number;
  readonly unusedPayloadBytes: number;
  readonly rows: readonly string[];
}

const LEVEL_DATA: Readonly<Record<ClassicLevelId, ClassicLevelData>> =
  Object.freeze({
    dirt: CLASSIC_LEVEL_DATA,
    "castle-strike": CASTLE_STRIKE_LEVEL_DATA,
    "liero-factory": FACTORY_LEVEL_DATA,
    "jail-break": JAIL_BREAK_LEVEL_DATA,
  });
for (const data of Object.values(LEVEL_DATA)) {
  Object.freeze(data.rows);
  Object.freeze(data);
}

export const CLASSIC_LEVELS = Object.freeze(
  Object.entries(LEVEL_DATA).map(([id, data]) =>
    Object.freeze({
      id: id as ClassicLevelId,
      name: data.name,
      width: data.width,
      height: data.height,
    }),
  ),
);

export const isClassicLevelId = (raw: unknown): raw is ClassicLevelId =>
  typeof raw === "string" && Object.hasOwn(LEVEL_DATA, raw);

export const CLASSIC_LEVEL_WIDTH = CLASSIC_LEVEL_DATA.width;
export const CLASSIC_LEVEL_HEIGHT = CLASSIC_LEVEL_DATA.height;
export const CLASSIC_LEVEL_NAME = CLASSIC_LEVEL_DATA.name;

/** Each world receives its own row container; physical level geometry is never rescaled. */
export function createClassicLevel(
  level: ClassicLevelId = "dirt",
): PixelTerrain {
  const data = LEVEL_DATA[level];
  return {
    width: data.width,
    height: data.height,
    rows: [...data.rows],
  };
}
