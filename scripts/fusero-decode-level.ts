/*
 *  MapLoader_LieroX.cpp
 *  OpenLieroX
 *
 *  Created by Albert Zeyer on 11.4.12.
 *  code under LGPL
 *
 */
// ALTERED SOURCE: TypeScript translation of native LXL v0 image-map decoding.
// Source: openlierox/openlierox 0a20c6d0a10ed63b28a15f05c771913c294efbf6,
// src/common/MapLoader_LieroX.cpp:38–170 and src/gusanos/material.h.
// Physical material flags follow the two RGB images; image colours never decide collision.
// Retain games/fusero/upstream/COPYING.LIB and the original source release notices.
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { inflateSync } from "node:zlib";
import { format } from "prettier";
import type { ClassicLevelData } from "../games/fusero/src/engine/classic/level.js";
import { encodeTerrainRow } from "../games/fusero/src/engine/classic/terrain.js";
import {
  AIR,
  DIRT,
  ROCK,
  MAX_TERRAIN_DIMENSION,
  MAX_TERRAIN_PIXELS,
  type MaterialIndex,
} from "../games/fusero/src/engine/classic/terrain-types.js";

export const CLASSIC_LEVEL_SHA256 =
  "a5aa3ea9a3327eddbe1c182a56713a74f91a8967fd128774ee36a20c50812403";
export const CLASSIC_LEVEL_FLAGS_SHA256 =
  "69d6a395a47006fc548f227566053a1962be7447d9c398e904739415d9174b80";
const SOURCE_PATH = "share/gamedir/levels/Dirt Level.lxl";
const HEADER_BYTES = 156;
export const NATIVE_LEVEL_SOURCES = [
  {
    file: "default-level.lxl",
    path: SOURCE_PATH,
    output: "level-data.ts",
    symbol: "CLASSIC_LEVEL_DATA",
    sha256: CLASSIC_LEVEL_SHA256,
    flagsSha256: CLASSIC_LEVEL_FLAGS_SHA256,
  },
  {
    file: "castle-strike.lxl",
    path: "share/gamedir/levels/CastleStrike.lxl",
    output: "level-castle-strike.ts",
    symbol: "CASTLE_STRIKE_LEVEL_DATA",
    sha256: "9b26d3f417e3a9a0c61909bf3b1d841831a1a492f37e2d45869e8f92d0d37517",
    flagsSha256:
      "7ef055fee10284c0db0865e0ba486c7ff35afe09021b3466764d1bc6a12f1047",
  },
  {
    file: "liero-factory.lxl",
    path: "share/gamedir/levels/Liero Factory.lxl",
    output: "level-factory.ts",
    symbol: "FACTORY_LEVEL_DATA",
    sha256: "25289df1b4561101a8cb1405acb75e9901755ee36200744c48622cb424ca171d",
    flagsSha256:
      "99e57d5b316c833cf654ebcb5de58b7b323a4cc7b91d6565bc6a24ac87ecf90d",
  },
  {
    file: "jail-break.lxl",
    path: "share/gamedir/levels/JailBreak.lxl",
    output: "level-jail-break.ts",
    symbol: "JAIL_BREAK_LEVEL_DATA",
    sha256: "8c03fb4b89ed8f6a414ac25569fffc32c219d9e29f32ad34ea2af62fa2e2aa56",
    flagsSha256:
      "ea5e2cd978202e0b23cc4bc0c4d49100a7739406900b89a9ba10084ad972b8fd",
  },
] as const;

/** Material::indexFromLxFlag gives ROCK precedence over DIRT; EMPTY is the fallback. */
export function materialFromLxFlag(flag: number): MaterialIndex {
  let material: MaterialIndex = AIR;
  if (flag & 0x02) material = DIRT;
  if (flag & 0x04) material = ROCK;
  return material;
}

export function decodeLxl(
  bytes: Uint8Array,
  sourcePath = SOURCE_PATH,
): ClassicLevelData {
  const source = Buffer.from(bytes);
  if (source.length < HEADER_BYTES || source.length > MAX_TERRAIN_PIXELS * 8)
    throw new Error("Invalid LXL source size");
  const text = (start: number, length: number) => {
    const field = source.subarray(start, start + length),
      end = field.indexOf(0);
    return field.subarray(0, end < 0 ? field.length : end).toString("utf8");
  };
  if (text(0, 32) !== "LieroX Level" || source.readInt32LE(32) !== 0)
    throw new Error("Unsupported LXL identity or version");
  const name = text(36, 64),
    width = source.readInt32LE(100),
    height = source.readInt32LE(104);
  const type = source.readInt32LE(108),
    theme = text(112, 32);
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width < 1 ||
    height < 1 ||
    width > MAX_TERRAIN_DIMENSION ||
    height > MAX_TERRAIN_DIMENSION ||
    width * height > MAX_TERRAIN_PIXELS
  )
    throw new Error("LXL dimensions exceed terrain snapshot limits");
  if (type !== 1)
    throw new Error("Only native LXL image maps are supported by this decoder");
  const compressedBytes = source.readUInt32LE(148),
    inflatedBytes = source.readUInt32LE(152),
    pixels = width * height;
  if (
    compressedBytes === 0 ||
    HEADER_BYTES + compressedBytes > source.length ||
    inflatedBytes < pixels * 7 ||
    inflatedBytes > MAX_TERRAIN_PIXELS * 7 + 1
  )
    throw new Error("Invalid LXL image payload bounds");
  const payload = inflateSync(
    source.subarray(HEADER_BYTES, HEADER_BYTES + compressedBytes),
    { maxOutputLength: inflatedBytes },
  );
  if (payload.length < pixels * 7)
    throw new Error(
      "LXL image payload is smaller than its physical pixel plane",
    );
  const flags = payload.subarray(pixels * 6, pixels * 7),
    materials = new Uint8Array(pixels);
  for (let i = 0; i < pixels; i++) materials[i] = materialFromLxFlag(flags[i]!);
  const rows = Array.from({ length: height }, (_, y) =>
    encodeTerrainRow(materials.subarray(y * width, (y + 1) * width)),
  );
  return {
    sourcePath,
    sourceSha256: createHash("sha256").update(source).digest("hex"),
    flagsSha256: createHash("sha256").update(flags).digest("hex"),
    materialSha256: createHash("sha256").update(materials).digest("hex"),
    name,
    theme,
    width,
    height,
    compressedBytes,
    inflatedBytes: payload.length,
    unusedPayloadBytes: payload.length - pixels * 7,
    rows,
  };
}

export async function generateClassicLevel(check = false): Promise<void> {
  for (const level of NATIVE_LEVEL_SOURCES) {
    const fixture = new URL(
      `../games/fusero/upstream/${level.file}`,
      import.meta.url,
    );
    const output = new URL(
      `../games/fusero/src/engine/classic/${level.output}`,
      import.meta.url,
    );
    const data = decodeLxl(readFileSync(fixture), level.path);
    if (
      data.sourceSha256 !== level.sha256 ||
      data.flagsSha256 !== level.flagsSha256
    )
      throw new Error(`Pinned native level digest mismatch: ${level.file}`);
    const generated = await format(
      `/* Generated by scripts/fusero-decode-level.ts from the pinned native ${level.path}.\n * Physical material data is unchanged; retain the upstream license notices. */\nimport type { ClassicLevelData } from "./level.js";\nexport const ${level.symbol}:ClassicLevelData=${JSON.stringify(data)};\n`,
      { parser: "typescript" },
    );
    if (check) {
      if (readFileSync(output, "utf8") !== generated)
        throw new Error(
          `Classic level data is stale: ${level.file}; run scripts/fusero-decode-level.ts`,
        );
    } else writeFileSync(output, generated);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await generateClassicLevel(process.argv.includes("--check"));
  console.log(
    process.argv.includes("--check")
      ? "Classic native level data matches its source"
      : "Generated Classic native level data",
  );
}
