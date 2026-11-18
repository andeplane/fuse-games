import assert from "node:assert/strict";
import test from "node:test";
import {
  ACTION,
  BOT,
  JOIN,
  LEAVE,
  PRESENCE,
  SPECTATOR,
  SETTINGS,
  packMessage,
  unpackMessage,
  type StreamEntries,
} from "fuse-netcode";
import { decodeRoom, encodeRoom, hashRoom } from "../src/game/checkpoint.js";
import { matchResult } from "../src/game/result.js";
import {
  BRAKE,
  CONTROLS,
  DEFAULT_SETTINGS,
  GAS,
  LEFT,
  LAPS,
  NITRO,
  PURCHASE,
  RIGHT,
  createRoom,
  trackNames,
  foldTick,
  type FuseDriversEntry,
  type FuseDriversRoom,
} from "../src/game/rules.js";
import { defined } from "./fixtures/defined.js";

/** Entry bodies (everything after seq and tick) each member logs at the next tick. */
type Bodies = Record<string, readonly unknown[][]>;
let seq = 0;
/** Folds one log tick of `bodies`, every stream at generation 1. */
function fold(room: FuseDriversRoom, bodies: Bodies = {}): void {
  const tick = room.tick + 1,
    streams = new Map<string, StreamEntries<FuseDriversEntry>>();
  for (const [id, list] of Object.entries(bodies))
    streams.set(id, {
      generation: 1,
      entries: list.map((body) => [++seq, tick, ...body] as FuseDriversEntry),
    });
  foldTick(room, "a", streams);
}
const runTo = (room: FuseDriversRoom, tick: number): void => {
  while (room.tick < tick) fold(room);
};

/** A lobby with one seat and no running race or campaign. */
function lobby(): FuseDriversRoom {
  const room = createRoom("m0", DEFAULT_SETTINGS);
  fold(room, { a: [[JOIN, "a", "Ada", 0, "fox", 1]] });
  return room;
}

/**
 * Two drivers, a bot and a watcher, driving long enough that the lights have gone out: past the countdown the
 * trucks are moving, the bots have steered and the CPU has entered its route program.
 */
function racing(ticks = 80, track = DEFAULT_SETTINGS.track): FuseDriversRoom {
  const room = createRoom("m0", { ...DEFAULT_SETTINGS, track });
  fold(room, {
    a: [
      [JOIN, "a", "Ada", 0, "fox", 1],
      [JOIN, "b", "Bo", 1, "cat", 1],
      [BOT, "add", "bot:1", "CPU 3", 2],
      [SPECTATOR, "join", "w", "Wat", 1],
    ],
  });
  fold(room, { a: [[ACTION, "start", "m1"]] });
  for (let step = 0; step < ticks; step++) {
    const at = room.tick + 1;
    fold(
      room,
      at % 5 === 0
        ? {
            a: [[CONTROLS, "m1", 1, at % 10 === 0 ? LEFT | NITRO : RIGHT]],
            b: [[CONTROLS, "m1", 1, at % 15 === 0 ? BRAKE : GAS]],
          }
        : {},
    );
  }
  return room;
}

/** The same race once it has been decided, as the fold leaves it: the room is over when the race is finished. */
function over(): FuseDriversRoom {
  const room = racing();
  const race = defined(room.race, "race");
  room.race = {
    ...race,
    phase: "finished",
    raceEndTick: race.tick,
    placements: race.trucks.map((truck) => truck.slot),
    trucks: race.trucks.map((truck) =>
      truck.slot === 0
        ? {
            ...truck,
            laps: LAPS,
            checkpoint: 0,
            progress: LAPS,
            finishedTick: race.tick,
          }
        : truck,
    ),
  };
  fold(room);
  return room;
}

/** Encoded as a snapshot carries it: through MessagePack and back. */
const wire = (room: FuseDriversRoom): unknown[] =>
  unpackMessage(packMessage(encodeRoom(room))) as unknown[];
const roundTrip = (room: FuseDriversRoom) => decodeRoom(wire(room), room.tick);
const at = (fields: unknown[], ...path: number[]): unknown[] =>
  path.reduce<unknown[]>((value, index) => value[index] as unknown[], fields);

test("the four leading fields are the ones the snapshot puts before the streams", () => {
  const fields = encodeRoom(racing(3));
  assert.equal(
    fields.length,
    10,
    "scalars, seats, settings, grid, then the rest",
  );
  assert.deepEqual(
    at(fields, 0),
    ["m1", 1, "running", 0, 1, 3],
    "the scalars, less the tick",
  );
  assert.ok(Array.isArray(fields[1]), "the seats");
  assert.deepEqual(fields[2], DEFAULT_SETTINGS, "the settings");
  assert.deepEqual(fields[3], ["a", "b", "bot:1"], "the grid");
});

test("a room in every stage survives the checkpoint whole: the same hash, and it folds on identically", () => {
  for (const [stage, room] of Object.entries({
    lobby: lobby(),
    racing: racing(),
    over: over(),
  })) {
    const decoded = roundTrip(room);
    assert.ok(decoded, `${stage} decodes`);
    assert.equal(hashRoom(decoded), hashRoom(room), stage);
    assert.deepEqual(decoded, room, `${stage} is rebuilt field for field`);
    runTo(decoded, room.tick + 40);
    runTo(room, room.tick + 40);
    assert.equal(hashRoom(decoded), hashRoom(room), `${stage} forty ticks on`);
  }
  const started = racing();
  assert.equal(started.stage, "running");
  assert.ok(
    defined(started.race, "race").tick >
      defined(started.race, "race").countdownEndTick,
    "the lights went out",
  );
  assert.equal(defined(started.race, "race").trucks.length, 3);
  assert.ok(
    defined(started.race).trucks.filter((t) => t.cpu).length === 1,
    "the bot remembers its course program",
  );

  // The decoded room shares nothing with the fields it came from.
  const fields = wire(started),
    decoded = defined(decodeRoom(fields, started.tick), "decoded");
  decoded.grid[0] = "zed";
  defined(decoded.race, "race").trucks[0]!.x = 1;
  defined(decoded.seats.get("a"), "seat").name = "Changed";
  assert.deepEqual(decodeRoom(fields, started.tick), roundTrip(started));
});

test("every course and reverse route restores an active CPU and continues the same race", () => {
  for (const track of trackNames()) {
    const room = racing(150, track);
    const restored = defined(roundTrip(room), track);
    const tick = room.tick + 12;
    runTo(room, tick);
    runTo(restored, tick);
    assert.equal(hashRoom(restored), hashRoom(room), track);
  }
});

test("updating next-race settings preserves the current race's course at recovery", () => {
  const room = racing();
  fold(room, { a: [[SETTINGS, { ...room.settings, track: "offroad-2" }]] });
  assert.equal(room.settings.track, "offroad-2");
  assert.equal(defined(room.race).trackName, DEFAULT_SETTINGS.track);
  assert.deepEqual(roundTrip(room), room);
});

test("a full CPU grid resumes the pace logic with its per-truck ranking registers", () => {
  const room = createRoom("m0", DEFAULT_SETTINGS);
  fold(room, {
    a: [
      [JOIN, "a", "Ada", 0, "fox", 1],
      [BOT, "add", "bot:1", "CPU 1", 1],
      [BOT, "add", "bot:2", "CPU 2", 2],
      [BOT, "add", "bot:3", "CPU 3", 3],
    ],
  });
  fold(room, { a: [[ACTION, "start", "m1"]] });
  runTo(room, 500);
  const restored = defined(roundTrip(room));
  assert.ok(restored.race?.trucks[3]?.cpu);
  runTo(restored, 620);
  runTo(room, 620);
  assert.equal(hashRoom(restored), hashRoom(room));
});

test("the CPU's retained tie order is independent of displayed placements and contributes to the room hash", () => {
  const room = racing(140);
  const before = hashRoom(room);
  const race = defined(room.race);
  room.race = {
    ...race,
    paceOrder: race.paceOrder.slice(1).concat(race.paceOrder[0]!),
  };
  assert.notEqual(hashRoom(room), before);
  const restored = defined(roundTrip(room));
  assert.deepEqual(restored.race?.paceOrder, room.race.paceOrder);
  assert.deepEqual(restored.race?.placements, race.placements);
  const tick = room.tick + 60;
  runTo(room, tick);
  runTo(restored, tick);
  assert.equal(hashRoom(restored), hashRoom(room));
});

test("a purchase restored between races determines the next truck setup identically", () => {
  const room = over();
  const old = room.garage.a!;
  fold(room, {
    a: [
      [
        PURCHASE,
        room.matchId,
        room.round,
        room.finishTick,
        "tires",
        old.cash,
        old.credits,
        old.tires,
      ],
    ],
  });
  assert.equal(room.garage.a!.tires, old.tires + 1);
  const restored = defined(roundTrip(room));
  for (const replica of [room, restored])
    fold(replica, { a: [[ACTION, "rematch", "m2"]] });
  assert.equal(restored.race?.trucks[0]?.upgrades?.tires, old.tires + 1);
  assert.deepEqual(restored, room);
  assert.deepEqual(roundTrip(restored), room);
});

/** Rewrites one encoded field of a running room; the result must be refused. */
function tampered(change: (fields: unknown[]) => void, tick?: number) {
  const room = racing(),
    fields = wire(room);
  change(fields);
  return decodeRoom(fields, tick ?? room.tick);
}

test("hidden-seat checkpoints preserve the authoritative away flag and return behavior", () => {
  const room = racing();
  fold(room, { b: [[PRESENCE, "b", false, 1]] });
  assert.equal(room.seats.get("b")?.away, true);
  const restored = defined(roundTrip(room));
  assert.equal(hashRoom(restored), hashRoom(room));
  assert.equal(restored.seats.get("b")?.away, true);
  for (const replica of [room, restored])
    fold(replica, { a: [[PRESENCE, "b", true, 1]] });
  assert.equal(restored.seats.get("b")?.connected, true);
  assert.equal(restored.seats.get("b")?.away, undefined);
  assert.equal(hashRoom(restored), hashRoom(room));
});

test("the finished roster survives departures and checkpoint recovery without changing receipts", () => {
  const room = over();
  const before = matchResult(room);
  fold(room, { a: [[LEAVE, "b"]] });
  assert.equal(room.seats.has("b"), false);
  assert.deepEqual(matchResult(room), before);
  const restored = defined(roundTrip(room));
  assert.equal(hashRoom(restored), hashRoom(room));
  assert.deepEqual(matchResult(restored), before);
  const fields = wire(room);
  const withoutReceipt = wire(room);
  withoutReceipt[9] = [];
  assert.equal(
    decodeRoom(withoutReceipt, room.tick),
    undefined,
    "a finished race must retain its receipt",
  );
  (fields[6] as unknown[]).pop();
  assert.equal(
    decodeRoom(fields, room.tick),
    undefined,
    "an incomplete finish roster is refused",
  );
});

test("a corrupt or hostile checkpoint is refused whole", () => {
  assert.ok(
    tampered(() => {}),
    "the untouched fields decode",
  );
  const refused: [string, (fields: unknown[]) => void, number?][] = [
    ["too few fields", (f) => f.pop()],
    ["a header that is not a list", (f) => (f[0] = "x")],
    ["a match id with spaces", (f) => (at(f, 0)[0] = "a b")],
    ["round 0", (f) => (at(f, 0)[1] = 0)],
    ["an unknown stage", (f) => (at(f, 0)[2] = "paused")],
    ["a stage with no race of its own", (f) => (at(f, 0)[2] = "between")],
    [
      "settings naming an unknown track",
      (f) => (f[2] = { track: "moon", display: false }),
    ],
    ["seats that are not a list", (f) => (f[1] = {})],
    ["a seat named __proto__", (f) => (at(f, 1, 0)[0] = "__proto__")],
    ["a seat past capacity", (f) => (at(f, 1, 0)[2] = 5)],
    ["two seats in one slot", (f) => (at(f, 1, 1)[2] = 0)],
    ["a watcher holding a slot", (f) => (at(f, 1, 3)[2] = 3)],
    ["a bot carrying a stream generation", (f) => (at(f, 1, 2)[6] = 1)],
    ["a grid naming nobody in the room", (f) => (at(f, 3)[0] = "zed")],
    ["a grid naming one seat twice", (f) => (at(f, 3)[0] = "b")],
    [
      "a grid id that is a prototype name",
      (f) => (at(f, 3)[0] = "constructor"),
    ],
    ["controls with an unknown bit", (f) => (at(f, 4, 0)[1] = 128)],
    ["controls keyed by __proto__", (f) => (at(f, 4, 0)[0] = "__proto__")],
    [
      "the same seat's controls twice",
      (f) => (f[4] as unknown[]).push(at(f, 4, 0)),
    ],
    ["a race in a room with no grid", (f) => (f[3] = [])],
    ["no race while the room is running", (f) => (f[5] = null)],
    ["a race that is not a list", (f) => (f[5] = "vroom")],
    ["a race naming an unknown course", (f) => (at(f, 5)[3] = "moon")],
    ["a race further ahead than the log", (f) => (at(f, 5)[0] = 100_000)],
    ["a seed past the DOS register", (f) => (at(f, 5)[2] = 65536)],
    ["a finished race in a running room", (f) => (at(f, 5)[1] = "finished")],
    ["a countdown that is already over", (f) => (at(f, 5)[1] = "countdown")],
    ["fewer trucks than the grid", (f) => at(f, 5, 6).pop()],
    ["more trucks than the grid", (f) => at(f, 5, 6).push(at(f, 5, 6)[0])],
    ["a truck claiming another slot", (f) => (at(f, 5, 6, 1)[0] = 0)],
    [
      "an infinite projected position",
      (f) => (at(f, 5, 6, 0, 1)[0] = Infinity),
    ],
    ["a nonfinite projected position", (f) => (at(f, 5, 6, 0, 1)[1] = NaN)],
    ["negative zero in a projection", (f) => (at(f, 5, 6, 0, 1)[0] = -0)],
    [
      "a native truck position beyond its coordinate register",
      (f) => (at(f, 5, 6, 0, 3)[0] = 65536),
    ],
    ["an overflowing throttle", (f) => (at(f, 5, 6, 0, 3)[5] = 257)],
    ["three-digit nitro stock", (f) => (at(f, 5, 6, 0, 3)[6] = 100)],
    ["a missing wheel", (f) => at(f, 5, 6, 0, 4).pop()],
    ["an invalid wheel velocity", (f) => (at(f, 5, 6, 0, 4, 2)[1] = 32768)],
    ["a contact mask naming a missing slot", (f) => (at(f, 5, 6, 0)[5] = 8)],
    ["a contact with the truck itself", (f) => (at(f, 5, 6, 0)[5] = 1)],
    [
      "one-sided truck contact",
      (f) => {
        at(f, 5, 6, 0)[5] = 2;
        at(f, 5, 6, 1)[5] = 0;
      },
    ],
    ["cash above the two-digit register", (f) => (at(f, 5, 6, 0)[6] = 100)],
    [
      "a human running a CPU program",
      (f) => (at(f, 5, 6, 0)[7] = at(f, 5, 6, 2)[7]),
    ],
    [
      "a CPU targeting an invalid opcode",
      (f) => (at(f, 5, 6, 2, 7)[2] = 65535),
    ],
    ["an invalid turn direction", (f) => (at(f, 5, 6, 0, 8)[0] = 2)],
    [
      "a nitro effect implausibly far ahead",
      (f) => (at(f, 5, 6, 0, 9)[0] = 1_000_000),
    ],
    ["a fraction of a lap", (f) => (at(f, 5, 6, 0, 10)[0] = 1.5)],
    ["a lap region beyond this course", (f) => (at(f, 5, 6, 0, 10)[1] = 255)],
    [
      "stats that are not numbers",
      (f) => (at(f, 5, 6, 0)[2] = ["fast", 1, 1, 1, 1, 1, 1]),
    ],
    ["placements that rank one slot twice", (f) => (at(f, 5)[7] = [0, 0, 1])],
    ["placements naming a slot off the grid", (f) => (at(f, 5)[7] = [0, 1, 9])],
    [
      "a pickup in an invented location",
      (f) => (at(f, 5)[8] = [0, 0, 0, ["cash", 0, 0]]),
    ],
    [
      "a pickup carrying a removed weapon",
      (f) => (at(f, 5)[8] = [0, 0, 0, ["mine", 896, 2048]]),
    ],
    [
      "an active pickup while the spawn timer runs",
      (f) => (at(f, 5)[8] = [2, 0, 0, ["cash", 896, 2048]]),
    ],
    ["an obsolete weapon list", (f) => at(f, 5).push([])],
    [
      "a ranking register outside its word",
      (f) => (at(f, 5, 6, 0)[11] = 65536),
    ],
    ["a human carrying a CPU base level", (f) => (at(f, 5, 6, 0)[12] = 2)],
    [
      "a bot losing its complete control program",
      (f) => {
        at(f, 5, 6, 2)[7] = null;
        at(f, 5, 6, 2)[12] = null;
      },
    ],
    [
      "a bot missing its original difficulty",
      (f) => (at(f, 5, 6, 2)[12] = null),
    ],
    [
      "a bot with the wrong starting difficulty for this race",
      (f) => (at(f, 5, 6, 2)[12] = 17),
    ],
    ["a human missing the vehicle setup", (f) => (at(f, 5, 6, 0)[13] = null)],
    [
      "a human racing with tires absent from the wallet",
      (f) => (at(f, 5, 6, 0)[13] = [0, 4, 0]),
    ],
    ["a repeated slot in the CPU tie order", (f) => (at(f, 5)[9] = [0, 0, 2])],
    ["a missing slot in the CPU tie order", (f) => (at(f, 5)[9] = [2, 1])],
    [
      "an unoccupied slot in the CPU tie order",
      (f) => (at(f, 5)[9] = [0, 2, 3]),
    ],
    [
      "a CPU carrying a human suspension purchase",
      (f) => (at(f, 5, 6, 2)[13] = [0, 0, 1]),
    ],
    [
      "a grade beyond the vehicle setup table",
      (f) => (at(f, 5, 6, 0)[13] = [6, 0, 1]),
    ],
    ["an invalid campaign index", (f) => (f[7] = -1)],
    ["another driver's wallet", (f) => (at(f, 8, 0)[0] = "b")],
    ["a missing wallet", (f) => at(f, 8).pop()],
    ["a malformed retained finish list", (f) => (f[9] = {})],
    ["a five-digit cash balance", (f) => (at(f, 8, 0)[1] = 10000)],
    ["a seventh tire grade", (f) => (at(f, 8, 0)[6] = 6)],
    ["a tick that is not a tick", () => {}, -1],
  ];
  for (const [what, change, tick] of refused)
    assert.equal(tampered(change, tick), undefined, what);

  assert.ok(
    tampered((f) => {
      at(f, 5)[8] = [0, 9, 8, ["nitro", 896, 2048]];
      at(f, 5, 6, 0, 3)[6] = 99;
      at(f, 5, 6, 0, 3)[0] = 65456;
      at(f, 5, 6, 0)[6] = 99;
    }),
    "valid upper-limit inventory and a course pickup survive",
  );

  // A lobby carries no race, and nothing that only a race can fill.
  const empty = lobby(),
    fields = wire(empty);
  assert.ok(decodeRoom(fields, empty.tick), "the lobby decodes");
  at(fields, 3).push("a");
  assert.equal(
    decodeRoom(fields, empty.tick),
    undefined,
    "a grid with no race",
  );
  const withRace = wire(empty);
  withRace[5] = wire(racing())[5];
  assert.equal(
    decodeRoom(withRace, empty.tick),
    undefined,
    "a race in the lobby",
  );

  // Over and finished are one fact, stated twice: they may not disagree.
  const decided = over(),
    ended = wire(decided);
  assert.ok(decodeRoom(ended, decided.tick), "the finished race decodes");
  at(ended, 5)[1] = "racing";
  assert.equal(
    decodeRoom(ended, decided.tick),
    undefined,
    "a room over while its race runs on",
  );
});
