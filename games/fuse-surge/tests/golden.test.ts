import test from "node:test";
import assert from "node:assert/strict";
import {
  DUCK,
  JUMP,
  RULES,
  botInput,
  createWorld,
  encodeWorld,
  stepWorld,
  type BotLevel,
  type Pace,
  type Rules,
  type World,
} from "../src/engine/index.js";
import * as T from "../src/engine/tuning.js";
import { scripted } from "./fixtures/world.js";

/**
 * The engine's safety net: scripted pilots play recorded matches at every pace and with different settings (jumps,
 * hops, dives, ducks, hits, knock-outs, footholds won back, flips, draws and the end of a match), and the world's
 * hash is compared every ten seconds. A refactor must keep these; a change to the rules must bump `RULES` in
 * `src/engine/index.ts` and re-record them in the same commit (`GOLDEN_RECORD=1` prints the new ones).
 *
 * The pilots are this test's own, so `pilots` moves only when the physics or the rules do. The engine's bot is part
 * of the rules too (every device folds a bot seat with it), so `bots` holds a second recording, of the bots playing
 * each other at every level: that one moves whenever the bot's answers do.
 */
const GOLDEN: { rules: string; pilots: string[][]; bots: string[][] } = {
  rules: "fuse-surge-2",
  pilots: [
    ["42724834", "63091594", "26714c6d", "6c282b90", "cc037c8d"],
    ["0f24b8be", "8d30ffe1", "e18bb564", "589ea6f6", "555d4d07", "36afaec0"],
    ["b8f69789", "cd76a91c", "56f8f230", "6d1e0f92", "895b055b", "d25a9c8e"],
    ["59663955", "9505b905", "dada6382"],
    ["0735f91c", "b12a585d"],
  ],
  bots: [
    [
      "18579e60",
      "a10813fd",
      "cb9e997c",
      "23aab50a",
      "eb945418",
      "3749c5d5",
      "d4772793",
      "069fc4db",
      "abf6df90",
      "d4624e5c",
      "0a1e2128",
      "a1deadf8",
      "c94137a3",
      "b86ca1b7",
      "b74f7026",
      "034b310e",
      "18854299",
      "080eb1ac",
    ],
    [
      "bcac3e6c",
      "5e9616b9",
      "3318c9f7",
      "852eb515",
      "aa1f54a6",
      "86de5d14",
      "740d59a3",
      "98982d2e",
    ],
    [
      "713808e4",
      "95cba097",
      "5080fa60",
      "074ba994",
      "e26d988b",
      "02d16dc8",
      "c195e280",
      "e4e11fb3",
      "74810611",
      "d1ac5d69",
      "13b3dc90",
      "18fa070f",
      "99ad46c9",
    ],
    ["8af6ffb7", "9f9e03cc", "f716a714"],
    [
      "6c94aec7",
      "19c2dd5b",
      "d427542c",
      "7b6dc899",
      "cb78f63b",
      "da35726f",
      "ed4e5e26",
      "2752749f",
    ],
  ],
};

function fnv(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++)
    h = Math.imul(h ^ text.charCodeAt(i), 0x01000193) >>> 0;
  return h.toString(16).padStart(8, "0");
}

/** Jumps and ducks by the roll, mostly when something is near, so it clears some surges and is struck by others. */
function pilot(world: World, slot: number, roll: number): number {
  const me = world.riders[slot]!;
  const near = world.surges.find(
    (surge) => !(surge.done & (1 << slot)) && surge.x - me.x < 90 * T.U,
  );
  if (!near) return roll % 23 === 0 ? JUMP : roll % 29 === 0 ? DUCK : 0;
  const sound = near.kind === 0 ? JUMP : DUCK;
  if (roll % 9 === 0) return sound === JUMP ? DUCK : JUMP;
  if (roll % 7 === 0) return 0;
  return roll % 11 === 0 ? JUMP | DUCK : sound;
}

const MATCHES: readonly { riders: number; rules: Rules }[] = [
  {
    riders: 2,
    rules: {
      hits: 3,
      seconds: 60,
      pace: 1,
      target: 3,
      recover: true,
      double: true,
      tall: true,
      boss: true,
      glide: false,
    },
  },
  {
    riders: 5,
    rules: {
      hits: 4,
      seconds: 30,
      pace: 2,
      target: 2,
      recover: true,
      double: true,
      tall: true,
      boss: false,
      glide: true,
    },
  },
  {
    riders: 3,
    rules: {
      hits: 2,
      seconds: 45,
      pace: 0,
      target: 2,
      recover: false,
      double: false,
      tall: false,
      boss: true,
      glide: false,
    },
  },
  {
    riders: 4,
    rules: {
      hits: 9,
      seconds: 20,
      pace: 1 as Pace,
      target: 1,
      recover: true,
      double: false,
      tall: false,
      boss: false,
      glide: false,
    },
  },
  {
    // An endless round with every switchable rule on.
    riders: 3,
    rules: {
      hits: 3,
      seconds: 0,
      pace: 2,
      target: 1,
      recover: true,
      double: true,
      tall: true,
      boss: true,
      glide: true,
    },
  },
];
const TICKS = 12_000,
  EVERY = 200;

function record(bots: boolean): string[][] {
  return MATCHES.map(({ riders, rules }) => {
    const world = createWorld(
        ["bot:1", "bot:2", "bot:3", "bot:4", "bot:5"].slice(0, riders),
        rules,
        20261114,
      ),
      next = scripted(20261114),
      hashes: string[] = [];
    const hash = () => hashes.push(fnv(JSON.stringify(encodeWorld(world))));
    for (let tick = 1; tick <= TICKS && world.phase !== "over"; tick++) {
      const inputs = world.riders.map((_, slot) =>
        bots
          ? botInput(world, slot, (slot % 3) as BotLevel)
          : pilot(world, slot, next()),
      );
      for (let i = 0; i < T.STEPS_PER_TICK; i++) stepWorld(world, inputs);
      if (tick % EVERY === 0) hash();
    }
    hash();
    return hashes;
  });
}

test("recorded matches replay to their recorded hashes under the current rules", () => {
  const pilots = record(false),
    bots = record(true);
  if (process.env.GOLDEN_RECORD)
    console.log(JSON.stringify({ rules: RULES, pilots, bots }));
  assert.equal(
    RULES,
    GOLDEN.rules,
    "RULES changed: re-record the golden in the same commit",
  );
  assert.deepEqual(
    pilots,
    GOLDEN.pilots,
    "the engine's behaviour changed: bump RULES and re-record, or fix the regression",
  );
  assert.deepEqual(
    bots,
    GOLDEN.bots,
    "the bot's play changed: bump RULES and re-record, or fix the regression",
  );
});
