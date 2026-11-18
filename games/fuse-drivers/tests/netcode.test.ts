import test from "node:test";
import assert from "node:assert/strict";
import {
  ACTION,
  BOT,
  FUTURE_TICKS,
  JOIN,
  PACKET_ENTRIES,
  SnapshotAssembler,
  World,
  decodeSnapshot,
  encodeSnapshot,
} from "fuse-netcode";
import {
  GAS,
  ITEM,
  CONTROLS,
  LEFT,
  NITRO,
  PURCHASE,
  RIGHT,
  createRoom,
  fuseDriversGame,
  type FuseDriversEntry,
  type FuseDriversEvent,
  type FuseDriversRoom,
  type FuseDriversSettings,
  type FuseDriversView,
} from "../src/game/index.js";
import type { RaceState } from "../src/game/sim/race.js";
import { encodeRoom } from "../src/game/checkpoint.js";
import { defined } from "./fixtures/defined.js";
import { SETTINGS } from "./fixtures/fuseDrivers.js";

type FuseDriversWorld = World<
  FuseDriversRoom,
  FuseDriversEntry,
  FuseDriversView,
  FuseDriversEvent,
  FuseDriversSettings
>;

/** The room this snapshot traffic belongs to, as the transport numbers it. */
const ROOM = 4;

/**
 * A replica of one room: the creator `a` (not seated) seats `b` at slot 0 and a bot at slot 1 at tick 1 and starts the
 * race at tick 2, so only `b`'s stream is remote and only `b` can stall the world.
 */
function replica(
  self = "a",
  matchId = "m1",
  settings = SETTINGS,
): FuseDriversWorld {
  const world = new World(
    fuseDriversGame,
    createRoom("m0", settings),
    "a",
    self,
  );
  const creator = world.stream("a", 1);
  world.stream("b", 1);
  creator.append(1, [JOIN, "b", "Bo", 0, "cat", 1]);
  creator.append(1, [BOT, "add", "bot:1", "CPU 2", 1]);
  creator.append(2, [ACTION, "start", matchId]);
  creator.through = 600;
  return world;
}

/**
 * What `b` holds on the wheel through a race: gas, steering, coasting and nitro. A seat logs only
 * when its controls change, so each of these is one entry and the truck keeps driving on it until the next one.
 */
const DRIVING: readonly number[] = [
  GAS,
  GAS | RIGHT,
  GAS | LEFT,
  GAS,
  GAS | LEFT,
  GAS | NITRO,
  GAS | LEFT,
  GAS,
  GAS | LEFT,
  LEFT,
  GAS | RIGHT,
  GAS | LEFT,
];
/** Those controls as `b`'s log: seq 1 upwards, the first inside the countdown and the rest spread over the race. */
const drivingLog: readonly FuseDriversEntry[] = DRIVING.map((bits, index) => [
  index + 1,
  index === 0 ? 5 : index * 30,
  CONTROLS,
  "m1",
  1,
  bits,
]);
const LAST_SEQ = defined(drivingLog.at(-1))[0];
/** Past every entry's tick, and past the stall bound of the ticks these tests run to. */
const THROUGH = 600;

/**
 * Feeds a log to a stream the way the transport does: packets of at most `PACKET_ENTRIES`, in order, each promising
 * completeness only through its own last entry, since its sender had logged nothing beyond it yet.
 */
function deliver(
  world: FuseDriversWorld,
  id: string,
  entries: readonly FuseDriversEntry[],
): void {
  for (let at = 0; at < entries.length; at += PACKET_ENTRIES) {
    const part = entries.slice(at, at + PACKET_ENTRIES);
    const last = defined(part.at(-1));
    world.receive(id, part, last[0], last[1], last[1]);
  }
}
/** An empty packet: the owner has logged nothing new, and its stream is complete through `through`. */
const promise = (
  world: FuseDriversWorld,
  id: string,
  lastSeq: number,
  through = THROUGH,
): void => void world.receive(id, [], lastSeq, through, through);

const raceOf = (room: FuseDriversRoom): RaceState => defined(room.race, "race");

test("a delayed opening purchase rolls back through START and converges on the upgraded grid", () => {
  const setup = () => {
    const world = new World(
      fuseDriversGame,
      createRoom("lobby", SETTINGS),
      "a",
      "a",
    );
    const host = world.stream("a", 1);
    world.stream("b", 1);
    host.append(1, [JOIN, "b", "Bo", 0, "cat", 1]);
    host.append(1, [BOT, "add", "bot:1", "CPU 2", 1]);
    host.append(30, [ACTION, "start", "race"]);
    host.through = 100;
    return world;
  };
  const onTime = setup(),
    late = setup();
  const buy: FuseDriversEntry = [
    1,
    25,
    PURCHASE,
    "lobby",
    1,
    0,
    "topSpeed",
    0,
    2,
    0,
  ];
  onTime.receive("b", [buy], 1, 100, 100);
  promise(late, "b", 0, 24);
  onTime.advance(55);
  late.advance(55);
  assert.equal(late.state.race!.trucks[0]!.upgrades?.topSpeed, 0);
  assert.ok(late.receive("b", [buy], 1, 100, 100).rollbackTicks > 0);
  assert.equal(late.receive("b", [buy], 1, 100, 100).rollbackTicks, 0);
  assert.equal(late.state.race!.trucks[0]!.upgrades?.topSpeed, 1);
  assert.equal(
    fuseDriversGame.hash(late.state),
    fuseDriversGame.hash(onTime.state),
  );
});

test("a late Battle item tap rewinds its hazard exactly once, including a same-tick release", () => {
  const settings = { ...SETTINGS, mode: "battle" as const };
  const timely = replica("a", "m1", settings),
    late = replica("a", "m1", settings);
  const tap: FuseDriversEntry[] = [
    [1, 70, CONTROLS, "m1", 1, ITEM],
    [2, 70, CONTROLS, "m1", 1, 0],
  ];
  timely.receive("b", tap, 2, 150, 150);
  timely.advance(80);
  promise(late, "b", 0, 69);
  late.advance(80);
  assert.equal(
    late.state.race!.battle!.bombs.some((b) => b.owner === 0),
    false,
  );
  assert.ok(late.receive("b", tap, 2, 150, 150).rollbackTicks > 0);
  assert.ok(timely.state.race!.battle!.bombs.some((b) => b.owner === 0));
  assert.deepEqual(late.state.race, timely.state.race);
  assert.equal(late.receive("b", tap, 2, 150, 150).rollbackTicks, 0);
  late.advance(150);
  timely.advance(150);
  assert.equal(
    fuseDriversGame.hash(late.state),
    fuseDriversGame.hash(timely.state),
  );
});
/** Total laps, including the fractional progress in the current lap. */
const progress = (world: FuseDriversWorld, slot: number): number =>
  defined(raceOf(world.state).trucks[slot], "truck").progress;

test("the same log folds to the same race and hash on every replica, however the packets batch it", () => {
  const whole = replica(),
    trickled = replica("b");
  deliver(whole, "b", drivingLog);
  promise(whole, "b", LAST_SEQ);
  whole.advance(400);

  // The same entries, one packet at a time, with the world simulating between them.
  for (const entry of drivingLog) {
    trickled.receive("b", [entry], entry[0], entry[1], entry[1]);
    trickled.advance(entry[1] + 20);
  }
  promise(trickled, "b", LAST_SEQ);
  trickled.advance(400);

  assert.equal(whole.tick, 400);
  assert.equal(trickled.tick, 400);
  assert.equal(
    fuseDriversGame.hash(whole.state),
    fuseDriversGame.hash(trickled.state),
  );
  assert.deepEqual(raceOf(whole.state), raceOf(trickled.state));
  // Not only the newest tick: the two agree at every tick both still retain.
  for (let tick = 360; tick <= 400; tick += 4)
    assert.equal(
      whole.hashAt(tick),
      trickled.hashAt(tick),
      `tick ${String(tick)}`,
    );
  assert.deepEqual(defined(whole.view()[0]), defined(trickled.view()[0]));
  assert.equal(raceOf(whole.state).phase, "racing", "the race is still on");
  assert.ok(
    defined(raceOf(whole.state).trucks[0]).checkpoint > 1,
    "b steered its truck past a checkpoint",
  );
  assert.ok(
    progress(whole, 1) > progress(whole, 0),
    "and the bot drove a race of its own out in front",
  );

  // A different match id seeds a different race from the very same log.
  const other = replica("a", "another");
  deliver(other, "b", drivingLog);
  promise(other, "b", LAST_SEQ);
  other.advance(400);
  assert.notEqual(
    fuseDriversGame.hash(other.state),
    fuseDriversGame.hash(whole.state),
  );
});

test("dropped, reordered and duplicated packets converge on the on-time race", () => {
  const onTime = replica();
  deliver(onTime, "b", drivingLog);
  promise(onTime, "b", LAST_SEQ);
  onTime.advance(400);

  const lossy = replica();
  const one = defined(drivingLog[0]),
    two = defined(drivingLog[1]),
    three = defined(drivingLog[2]),
    four = defined(drivingLog[3]);
  lossy.receive("b", [one, two], two[0], two[1], two[1]);
  lossy.advance(70);
  assert.equal(lossy.state.controls.b, two[5], "b is steering on seq 2");

  // Seq 3 is dropped and seq 4 arrives in its place: the gap holds seq 4 back and caps how far the world may run.
  lossy.receive("b", [four], four[0], four[1] - 1, four[1]);
  lossy.advance(95);
  assert.equal(lossy.state.controls.b, two[5], "seq 4 is still behind the gap");
  // A duplicate of a packet already held changes nothing at all.
  const duplicate = lossy.receive("b", [four], four[0], four[1] - 1, four[1]);
  assert.equal(duplicate.status, "accepted");
  assert.equal(duplicate.rollbackTicks, 0);
  assert.deepEqual(duplicate.added, []);

  // The repair arrives, with seq 4 beside it, and rewrites the ticks since seq 3's.
  const repaired = lossy.receive("b", [three, four], four[0], four[1], 95);
  assert.equal(repaired.status, "accepted");
  assert.ok(repaired.rollbackTicks > 0, "the repair rolled the world back");
  assert.equal(lossy.state.controls.b, four[5], "and seq 4 is folded in");

  deliver(lossy, "b", drivingLog.slice(4));
  // The whole log once more, which every packet's rotating tail does in the real transport.
  deliver(lossy, "b", drivingLog);
  promise(lossy, "b", LAST_SEQ);
  lossy.advance(400);

  assert.ok(lossy.rollbacks > 0);
  assert.equal(
    fuseDriversGame.hash(lossy.state),
    fuseDriversGame.hash(onTime.state),
  );
  assert.deepEqual(raceOf(lossy.state), raceOf(onTime.state));
  assert.equal(lossy.hashAt(396), onTime.hashAt(396));
});

test("a late entry inside the rollback window rewrites history and every replica agrees afterwards", () => {
  // The gas and left turn at tick 60 are still in flight on the late replica at tick 99.
  const turn: FuseDriversEntry = [1, 60, CONTROLS, "m1", 1, GAS | LEFT];
  const after: FuseDriversEntry = [2, 130, CONTROLS, "m1", 1, NITRO];

  const onTime = replica();
  onTime.receive("b", [turn], 1, 120, 120);
  onTime.advance(120);

  const late = replica();
  // `b` has promised its stream only through tick 59, and the replica speculates the 40 ticks past it that it may.
  promise(late, "b", 0, 59);
  late.advance(120);
  assert.equal(late.tick, 99, "the stall bound held it 40 ticks past 59");
  assert.equal(
    late.state.controls.b,
    undefined,
    "it drove b's truck on neutral controls",
  );
  assert.notEqual(
    fuseDriversGame.hash(late.state),
    fuseDriversGame.hash(onTime.state),
  );

  const corrected = late.receive("b", [turn], 1, 120, 120);
  assert.equal(corrected.status, "accepted");
  assert.ok(
    corrected.rollbackTicks >= 99 - 60,
    "history was re-simulated from the entry's own tick",
  );
  late.advance(120);
  assert.equal(late.state.controls.b, turn[5]);
  assert.equal(
    fuseDriversGame.hash(late.state),
    fuseDriversGame.hash(onTime.state),
  );
  assert.deepEqual(raceOf(late.state), raceOf(onTime.state));
  assert.equal(late.hashAt(116), onTime.hashAt(116));
  assert.deepEqual(
    defined(late.view()[0]),
    defined(onTime.view()[0]),
    "the arena shows the corrected race",
  );
  // The same packet again is not a second rollback.
  const again = late.receive("b", [turn], 1, 120, 120);
  assert.equal(again.rollbackTicks, 0);
  assert.deepEqual(again.events, []);

  // And the two carry on together from there.
  for (const world of [onTime, late]) {
    world.receive("b", [after], 2, THROUGH, THROUGH);
    world.advance(300);
  }
  assert.equal(
    fuseDriversGame.hash(late.state),
    fuseDriversGame.hash(onTime.state),
  );
  assert.deepEqual(raceOf(late.state), raceOf(onTime.state));
});

test("a replica far behind recovers the race from a snapshot and folds on identically", () => {
  const source = replica();
  deliver(source, "b", drivingLog);
  promise(source, "b", LAST_SEQ);
  source.advance(240);
  assert.ok(
    progress(source, 1) > 0.5,
    "the snapshot carries a CPU half a lap into the race",
  );

  const chunks = encodeSnapshot(source, ROOM);
  assert.equal(defined(chunks[0]).rules, "fuse-drivers-7");
  const assembler = new SnapshotAssembler(fuseDriversGame, ROOM);
  let complete: { tick: number; bytes: Uint8Array } | undefined;
  for (const chunk of chunks) complete = assembler.accept(chunk);
  assert.ok(complete, "the chunks reassemble");
  const decoded = decodeSnapshot(fuseDriversGame, complete.bytes, ROOM);
  assert.ok(decoded, "and decode into a race");
  assert.equal(decoded.state.tick, 240);
  assert.equal(
    fuseDriversGame.hash(decoded.state),
    fuseDriversGame.hash(source.servable().state),
  );

  // A device that never saw the first 240 ticks installs the snapshot and rebuilds every stream from its metadata.
  const joiner = new World(
    fuseDriversGame,
    createRoom("m0", SETTINGS),
    "a",
    "c",
  );
  joiner.install(decoded.state);
  for (const stream of decoded.streams) {
    const log = joiner.stream(stream.id, stream.generation, {
      seq: stream.seq,
      tick: decoded.state.tick,
      ordinal: stream.ordinal,
    });
    log.through = THROUGH;
    for (let at = 0; at < stream.entries.length; at += PACKET_ENTRIES) {
      const part = stream.entries.slice(at, at + PACKET_ENTRIES);
      log.receive(
        part,
        defined(part.at(-1))[0],
        THROUGH,
        THROUGH,
        decoded.state.tick,
      );
    }
  }
  assert.equal(
    fuseDriversGame.hash(joiner.state),
    fuseDriversGame.hash(source.state),
    "the recovered room is the room it was taken from",
  );

  // From here the two fold the same log, and the recovered replica's race stays byte-identical.
  source.advance(400);
  joiner.advance(400);
  assert.equal(joiner.tick, 400);
  assert.equal(
    fuseDriversGame.hash(joiner.state),
    fuseDriversGame.hash(source.state),
  );
  assert.deepEqual(raceOf(joiner.state), raceOf(source.state));
  assert.equal(
    JSON.stringify(encodeRoom(joiner.state)),
    JSON.stringify(encodeRoom(source.state)),
    "the recovered and uninterrupted replicas serialize to the same checkpoint bytes",
  );
  assert.equal(joiner.hashAt(396), source.hashAt(396));

  // A snapshot altered in flight is refused rather than installed.
  const flipped = complete.bytes.slice();
  const at = flipped.length - 3;
  flipped[at] = defined(flipped[at]) ^ 0xff;
  assert.equal(decodeSnapshot(fuseDriversGame, flipped, ROOM), undefined);
});

test("controls stamped beyond the future window are refused, and the race is unchanged", () => {
  const world = replica();
  deliver(world, "b", drivingLog);
  promise(world, "b", LAST_SEQ, 340);
  world.advance(200);
  const before = fuseDriversGame.hash(world.state);

  const beyond: FuseDriversEntry = [
    LAST_SEQ + 1,
    200 + FUTURE_TICKS + 1,
    CONTROLS,
    "m1",
    1,
    LEFT,
  ];
  const refused = world.receive("b", [beyond], beyond[0], 340, 200);
  assert.equal(refused.status, "invalid");
  assert.equal(refused.refusal, "window");
  assert.deepEqual(refused.added, []);
  assert.equal(fuseDriversGame.hash(world.state), before);

  // One tick inside the window is a peer whose clock merely runs ahead, and is taken.
  const inside: FuseDriversEntry = [
    LAST_SEQ + 1,
    200 + FUTURE_TICKS,
    CONTROLS,
    "m1",
    1,
    LEFT,
  ];
  const taken = world.receive("b", [inside], inside[0], 340, 200);
  assert.equal(taken.status, "accepted");
  assert.deepEqual(taken.added, [inside]);
  // Nothing it does is visible yet: it is stamped hundreds of ticks ahead of the fold.
  assert.equal(fuseDriversGame.hash(world.state), before);
});
