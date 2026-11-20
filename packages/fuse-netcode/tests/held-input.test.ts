import assert from "node:assert/strict";
import test from "node:test";
import {
  entriesForGeneration,
  foldHeldInput,
  type SeatRecord,
  type StreamEntries,
} from "../src/index.js";

type Command = readonly [
  seq: number,
  tick: number,
  matchId: string,
  bits: number,
];

const human: SeatRecord = {
  id: "player",
  name: "Player",
  slot: 0,
  connected: true,
  bot: false,
  avatarId: "rider",
  generation: 1,
};

test("generation lookup keeps the selected stream's entries and order", () => {
  const stream: StreamEntries<Command> = {
    generation: 2,
    entries: [],
    retired: [
      {
        generation: 1,
        entries: [
          [5, 9, "match", 2],
          [4, 9, "match", 1],
        ],
      },
      { generation: 1, entries: [[6, 9, "match", 4]] },
      { generation: 2, entries: [[7, 9, "match", 8]] },
    ],
  };
  assert.equal(entriesForGeneration(stream, 1), stream.retired![0]!.entries);
  assert.equal(entriesForGeneration(stream, 2), stream.entries);
  assert.deepEqual(entriesForGeneration(stream, undefined), []);
  assert.deepEqual(entriesForGeneration(undefined, 1), []);
});

test("held input follows the seated generation, filters commands and keeps the last sequence", () => {
  const room = { seats: new Map([[human.id, human]]), held: { [human.id]: 8 } };
  const streams = new Map<string, StreamEntries<Command>>([
    [
      human.id,
      {
        generation: 2,
        entries: [[1, 9, "match", 16]],
        retired: [
          {
            generation: 1,
            entries: [
              [5, 9, "match", 2],
              [4, 9, "match", 1],
              [6, 8, "match", 4],
              [7, 9, "old-match", 8],
            ],
          },
        ],
      },
    ],
  ]);
  const read = (entry: Command) =>
    entry[2] === "match" ? entry[3] : undefined;
  const deniedBot = () => {
    throw new Error("human seat asked for bot input");
  };

  assert.deepEqual(
    foldHeldInput(room, streams, 9, read)(human.id, deniedBot),
    [2, 3],
  );
  assert.deepEqual(room.held, { [human.id]: 2 });
  assert.deepEqual(
    foldHeldInput(room, streams, 10, read)(human.id, deniedBot),
    [2, 0],
  );
  const released = new Map<string, StreamEntries<Command>>([
    [
      human.id,
      {
        generation: 1,
        entries: [
          [8, 10, "match", 0],
          [7, 10, "match", 1],
        ],
      },
    ],
  ]);
  assert.deepEqual(
    foldHeldInput(room, released, 10, read)(human.id, deniedBot),
    [0, 1],
  );
  assert.deepEqual(room.held, {});
});

test("disconnection clears held input and bot answers last only for the current tick", () => {
  const bot = { ...human, id: "bot:1", bot: true, generation: undefined };
  const room = {
    seats: new Map([
      [human.id, { ...human, connected: false }],
      [bot.id, bot],
    ]),
    held: { [human.id]: 1, [bot.id]: 2, missing: 4 },
  };
  const fold = foldHeldInput(room, new Map(), 9, () => undefined);
  const deniedBot = () => {
    throw new Error("non-bot seat asked for bot input");
  };
  assert.deepEqual(fold(human.id, deniedBot), [0, 0]);
  assert.deepEqual(fold("missing", deniedBot), [0, 0]);
  assert.deepEqual(
    fold(bot.id, () => 8),
    [8, 0],
  );
  assert.deepEqual(
    fold(bot.id, () => 0),
    [0, 0],
  );
  assert.deepEqual(room.held, {});
});
