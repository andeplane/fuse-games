/*
 * OpenLieroX Classic material boundary — altered TypeScript port for Fusero.
 * Source: openlierox/openlierox 0a20c6d0a10ed63b28a15f05c771913c294efbf6.
 * Based on Jason Boettcher's work, enhanced by Dark Charlie and Albert Zeyer.
 * Code under LGPL; retain the upstream COPYING.LIB distributed with this port.
 */
export const ROCK = 0;
export const AIR = 1;
export const DIRT = 2;
export type MaterialIndex = typeof ROCK | typeof AIR | typeof DIRT;

/**
 * One UTF-16 code unit per run: 32 + (length - 1) * 3 + native material index.
 * Runs are positive, sum to width and adjacent materials differ. This is a
 * canonical, JSON/MessagePack-safe representation with immutable shared rows.
 */
export interface PixelTerrain {
  width: number;
  height: number;
  rows: string[];
}

export const MAX_TERRAIN_DIMENSION = 4095;
/** Leave snapshot space for players/projectiles beneath fuse-netcode's 2.6 MB limit. */
export const MAX_TERRAIN_PIXELS = 2_000_000;

export interface TerrainMaterial {
  readonly wormPass: boolean;
  readonly particlePass: boolean;
  readonly canHook: boolean;
  readonly destroyable: boolean;
  readonly damage: number;
}

/** src/gusanos/level.cpp: the three material indices used by Classic/LX maps. */
export const CLASSIC_MATERIALS: readonly TerrainMaterial[] = [
  {
    wormPass: false,
    particlePass: false,
    canHook: true,
    destroyable: false,
    damage: 0,
  },
  {
    wormPass: true,
    particlePass: true,
    canHook: false,
    destroyable: false,
    damage: 0,
  },
  {
    wormPass: false,
    particlePass: false,
    canHook: true,
    destroyable: true,
    damage: 0,
  },
];
