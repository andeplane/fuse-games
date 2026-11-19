import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  decodeState,
  hashState,
  step,
  type Command,
  type World,
} from "../../games/fuse-craft/src/engine/index.js";

export interface CraftReplay {
  initial: unknown;
  commands: readonly { tick: number; commands: Command[] }[];
  ticks: number;
  hash: string;
}

export function loadCraftReplay(file: string): CraftReplay {
  return JSON.parse(readFileSync(file, "utf8")) as CraftReplay;
}

/** Rebuild the recorded world with production commands and verify the final hash. */
export function verifyCraftReplay(
  recording: CraftReplay,
  observe?: (world: World, previous: World) => void,
  mismatch?: string,
): void {
  let world = decodeState(JSON.stringify(recording.initial));
  let cursor = 0;
  while (world.tick < recording.ticks) {
    const row = recording.commands[cursor];
    const inputs = row?.tick === world.tick ? (cursor++, row.commands) : [];
    const previous = world;
    world = step(world, inputs);
    if (world.tick <= previous.tick)
      throw new Error(
        `Replay stopped at tick ${world.tick} before declared end ${recording.ticks}`,
      );
    observe?.(world, previous);
  }
  assert.equal(hashState(world), recording.hash, mismatch);
}
