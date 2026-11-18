import { test } from "node:test";
import assert from "node:assert/strict";
import type { Frame } from "fuse-netcode";
import { SoloBattle } from "../src/app/solo.js";
import type { BirdsView } from "../src/online/game.js";

test("local room owns AI seats, ordinary turns, a result and a rematch", () => {
  let frame: Frame<BirdsView>,
    tick = () => {},
    active = true;
  const shooters = new Set<string>();
  const battle = new SoloBattle(
    {
      state: (next) => {
        frame = next;
      },
      event: (fact) => {
        if (fact.type === "shot") shooters.add(fact.actor!);
      },
      ready() {},
      status() {},
    },
    {
      name: "You",
      seed: 123,
      active: () => active,
      schedule: (next) => {
        tick = next;
        return () => {};
      },
    },
  );
  battle.start();
  const stage = () => frame.stage;
  assert.equal(stage(), "lobby");
  assert.equal(
    battle.command({ type: "bot", action: "remove", id: "ai-1" }),
    true,
  );
  assert.equal(battle.command({ type: "action", action: "start" }), false);
  for (let slot = 1; slot < 5; slot++)
    assert.ok(battle.command({ type: "bot", action: "add", slot }));
  assert.equal(battle.command({ type: "bot", action: "add" }), false);
  for (let slot = 2; slot < 5; slot++)
    assert.ok(
      battle.command({ type: "bot", action: "remove", id: `ai-${slot}` }),
    );
  assert.ok(battle.command({ type: "action", action: "start" }));
  active = false;
  tick();
  assert.equal(frame!.logTick, 0);
  active = true;
  for (let i = 0; i < 30000 && stage() !== "over"; i++) {
    const world = frame!.world!;
    if (world.phase === "aiming" && world.players[world.active]?.id === "solo")
      assert.ok(
        battle.play({ type: "launch", weapon: "pebble", vx: 1536, vy: -1600 }),
      );
    else assert.equal(battle.play({ type: "pass" }), false);
    tick();
  }
  assert.equal(frame!.world?.phase, "over");
  assert.deepEqual(shooters, new Set(["solo", "ai-1"]));
  const seats = frame!.seats;
  assert.ok(battle.command({ type: "action", action: "rematch" }));
  assert.equal(frame!.world?.round, 2);
  assert.deepEqual(frame!.seats, seats);
  battle.stop();
  assert.equal(battle.admitted, false);
});
