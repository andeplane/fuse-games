import test from "node:test";
import assert from "node:assert/strict";
import {
  ACTION,
  JOIN,
  TickClock,
  StreamLog,
  World,
  SnapshotAssembler,
  encodeSnapshot,
  decodeSnapshot,
  logTiming,
  RETAINED_ENTRIES,
  PACKET_ENTRIES,
} from "../src/index.js";
import {
  ADD,
  counterGame,
  hashCounter,
  type CounterEntry,
} from "./fixtures/counter-game.js";
import { FakeMesh } from "./fixtures/fake-mesh.js";

test("trusted cadences are bounded and keep hash ticks aligned with retained snapshots", () => {
  for (const ms of [0, 9, 11, 14, 49, 51, NaN, Infinity, 10.5])
    assert.throws(() => logTiming(ms), RangeError);
  for (const ms of [10, 20, 25, 40, 50]) {
    const timing = logTiming(ms);
    assert.equal(timing.hashInterval % timing.snapshotInterval, 0);
    assert.equal(timing.hashLag % timing.snapshotInterval, 0);
  }
});

for (const tickMs of [50, 10]) {
  const timing = logTiming(tickMs),
    game = { ...counterGame, tickMs, rules: `counter-cadence-${tickMs}` };
  test(`${tickMs}ms clocks preserve RTT, wall-time slew and pause duration`, () => {
    let now = 0;
    const authority = new TickClock(() => now, tickMs);
    authority.start();
    now = 1000;
    assert.equal(authority.tick() * tickMs, 1000);
    authority.pause();
    now += 5000;
    authority.resume();
    now += 100;
    assert.equal(authority.tick() * tickMs, 1100);
    const follower = new TickClock(() => now, tickMs);
    follower.sample(1000 / tickMs, 100);
    assert.equal(follower.tick() * tickMs, 1050);
    now += 100;
    follower.sample(2000 / tickMs, 0);
    const before = follower.tick() * tickMs;
    now += 1000;
    assert.ok(Math.abs(follower.tick() * tickMs - before - 1050) < 1e-8);
  });

  test(`${tickMs}ms streams preserve two-second rollback and resend windows without raising entry caps`, () => {
    const current = 3000 / tickMs;
    const receive = (age: number) => {
      const stream = new StreamLog(game, 1, undefined, timing);
      const entry: CounterEntry = [1, current - age / tickMs, ADD, 3];
      return stream.receive([entry], 1, current, current, current);
    };
    assert.equal(receive(1500).status, "accepted");
    assert.equal(receive(2000).status, "unrepairable");
    const future = new StreamLog(game, 1, undefined, timing);
    assert.equal(
      future.receive(
        [[1, current + 20_000 / tickMs, ADD, 1]],
        1,
        current,
        current,
        current,
      ).status,
      "accepted",
    );
    assert.equal(
      future.receive(
        [[2, current + 20_000 / tickMs + 1, ADD, 1]],
        2,
        current,
        current,
        current,
      ).status,
      "invalid",
    );
    const stream = new StreamLog(game, 1, undefined, timing);
    for (let i = 1; i <= 100; i++) stream.append(i, [ADD, 1]);
    stream.through = 100;
    assert.ok(stream.retained().length <= RETAINED_ENTRIES);
    assert.ok(stream.packetEntries().length <= PACKET_ENTRIES);
    stream.through = 100 + 2000 / tickMs;
    assert.deepEqual(stream.retained(), []);
  });

  test(`${tickMs}ms worlds replay a 1.5-second-late input and restore pending snapshot entries`, () => {
    const create = () => {
      const world = new World(
        game,
        game.createRoom("m", { target: 1000 }),
        "a",
        "a",
      );
      const a = world.stream("a", 1);
      world.stream("b", 1);
      a.append(1, [JOIN, "a", "A", 0, "fox", 1]);
      a.append(1, [JOIN, "b", "B", 1, "fox", 1]);
      a.append(2, [ACTION, "start", "m"]);
      a.through = 4000 / tickMs;
      return world;
    };
    const whole = create(),
      late = create(),
      entry: CounterEntry = [1, 1000 / tickMs, ADD, 7],
      at = 2500 / tickMs;
    whole.receive("b", [entry], 1, at, at);
    whole.advance(at);
    late.receive("b", [], 0, entry[1] - 1, at);
    late.advance(at);
    late.receive("b", [entry], 1, at, at);
    late.advance(at);
    assert.ok(late.rollbacks > 0);
    assert.equal(hashCounter(late.state), hashCounter(whole.state));
    assert.equal(late.state.totals.b, 7);
    assert.ok(late.hashAt(1000 / tickMs), "one-second hash target is retained");
    // A five-second-ahead replay tail is valid at both cadences (not just 400 fast ticks).
    late.streams.get("a")!.append(at + 5000 / tickMs, [ADD, 2]);
    const assembler = new SnapshotAssembler(game, 7);
    let complete: ReturnType<typeof assembler.accept>;
    for (const chunk of encodeSnapshot(late, 7))
      complete = assembler.accept(chunk);
    assert.ok(complete);
    const restored = decodeSnapshot(game, complete.bytes, 7);
    assert.ok(restored);
    assert.equal(
      hashCounter(restored.state),
      hashCounter(late.servable().state),
    );
    assert.ok(
      restored.streams.some((stream) =>
        stream.entries.some((e) => e[1] === at + 5000 / tickMs),
      ),
    );
  });

  test(`${tickMs}ms live rooms converge through loss, reorder, duplication and peer reload`, () => {
    const mesh = new FakeMesh("a", { target: 1000 }),
      a = mesh.join("a", game),
      b = mesh.join("b", game);
    mesh.run(200);
    a.command({ type: "join", name: "A" });
    b.command({ type: "join", name: "B" });
    mesh.run(3000);
    a.command({ type: "action", action: "start" });
    mesh.run(200);
    const before = a.roomState()!.tick;
    mesh.run(1000);
    assert.equal(a.roomState()!.tick - before, 1000 / tickMs);
    mesh.fast = (_from, _to, sent) =>
      sent % 4 === 0
        ? { drop: true }
        : {
            delayMs: sent % 3 === 0 ? 90 : 20,
            duplicateMs: 120,
          };
    for (let i = 0; i < 20; i++) {
      assert.ok((i % 2 ? a : b).add(2));
      mesh.run(30);
    }
    mesh.fast = () => ({ delayMs: 20 });
    mesh.run(3000);
    assert.equal(a.roomState()!.totals.a, 20);
    assert.equal(b.roomState()!.totals.b, 20);
    b.stop();
    const returned = mesh.join("b", game, 2);
    mesh.run(3500);
    assert.equal(returned.sync.state, "Live");
    assert.equal(returned.roomState()!.totals.a, 20);
    assert.equal(returned.roomState()!.totals.b, 20);
    assert.ok(returned.command({ type: "join", name: "B" }));
    mesh.run(500);
    assert.equal(a.roomState()!.seats.get("b")?.generation, 2);
    assert.ok(returned.add(3));
    mesh.run(500);
    const target =
      Math.floor(
        (Math.min(a.roomState()!.tick, returned.roomState()!.tick) -
          timing.snapshotInterval) /
          timing.snapshotInterval,
      ) * timing.snapshotInterval;
    assert.ok(a.hashAt(target));
    assert.equal(a.hashAt(target), returned.hashAt(target));
    assert.equal(a.roomState()!.totals.b, 23);
    a.stop();
    returned.stop();
  });
}
