/*
 * OpenLieroX default level physical data — altered TypeScript adapter for Fusero.
 * Source: openlierox/openlierox 0a20c6d0a10ed63b28a15f05c771913c294efbf6.
 * Retain the upstream license notices distributed with this port.
 */
import { CLASSIC_LEVEL_DATA } from "./level-data.js";
import type { PixelTerrain } from "./terrain-types.js";

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

Object.freeze(CLASSIC_LEVEL_DATA.rows);
Object.freeze(CLASSIC_LEVEL_DATA);

export const CLASSIC_LEVEL_WIDTH = CLASSIC_LEVEL_DATA.width;
export const CLASSIC_LEVEL_HEIGHT = CLASSIC_LEVEL_DATA.height;
export const CLASSIC_LEVEL_NAME = CLASSIC_LEVEL_DATA.name;

/** Each world receives its own row container; physical level geometry is never rescaled. */
export function createClassicLevel(): PixelTerrain {
  return {
    width: CLASSIC_LEVEL_WIDTH,
    height: CLASSIC_LEVEL_HEIGHT,
    rows: [...CLASSIC_LEVEL_DATA.rows],
  };
}
