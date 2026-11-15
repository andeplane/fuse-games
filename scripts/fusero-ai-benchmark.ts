/** Fixed workload for native AI/checkpoint size; run on cloud-ci, not the preview host. */
import assert from "node:assert/strict";
import { encode } from "@msgpack/msgpack";
import {
  createWorld,
  stepWorld,
} from "../games/fusero/src/engine/classic/world.js";
import {
  decodeWorld,
  encodeWorld,
} from "../games/fusero/src/engine/classic/codec.js";
import { DEFAULT_SETTINGS } from "../games/fusero/src/engine/classic/match-types.js";
import type { ClassicLevelId } from "../games/fusero/src/engine/classic/level-types.js";

const levels: ClassicLevelId[] = [
  "jail-break",
  "castle-strike",
  "liero-factory",
  "dirt",
];
for (const level of levels) {
  const seed = 0x46555345;
  const world = createWorld(
    seed,
    Array.from({ length: 5 }, (_, slot) => ({
      id: `bot-${slot}`,
      slot,
      bot: true,
    })),
    { ...DEFAULT_SETTINGS, level, killLimit: -1, timeLimitMs: -1 },
  );
  let maxBytes = 0,
    maxAreas = 0,
    samples = 0;
  const started = performance.now();
  for (let step = 0; step < 36_000; step++) {
    stepWorld(world, new Map());
    for (const worm of world.worms)
      maxAreas = Math.max(maxAreas, worm.ai?.search?.areas.length ?? 0);
    if (step % 500 !== 499) continue;
    const checkpoint = encodeWorld(world);
    const bytes = encode(checkpoint).byteLength;
    maxBytes = Math.max(maxBytes, bytes);
    assert.ok(
      bytes < 2_600_000,
      `${level}: checkpoint exceeds room transport bound`,
    );
    assert.ok(
      decodeWorld(checkpoint),
      `${level}: active AI checkpoint rejected at ${world.elapsedMs}ms`,
    );
    samples++;
  }
  console.log(
    JSON.stringify({
      level,
      seed,
      bots: 5,
      simulatedMs: world.elapsedMs,
      wallMs: Math.round(performance.now() - started),
      samples,
      maxCheckpointBytes: maxBytes,
      maxSearchAreasPerBot: maxAreas,
      deaths: world.worms.reduce((n, w) => n + w.deaths, 0),
    }),
  );
}
