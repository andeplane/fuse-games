import test from "node:test";
import assert from "node:assert/strict";
import { CounterRuntime } from "./fixtures/fake-mesh.js";
import { counterGame } from "./fixtures/counter-game.js";

test("a game can prepare its seated solo roster before explicitly starting play", () => {
  let now = 0;
  let loop: (() => void) | undefined;
  const runtime = new CounterRuntime(
    counterGame,
    "SOLO",
    { target: 5 },
    {
      state: () => {},
      event: () => {},
      status: () => {},
      ready: () => {},
    },
    {
      autoStartSolo: false,
      humanName: "Ada",
      dependencies: {
        now: () => now,
        hidden: () => false,
        token: () => "prepared-match",
        generation: () => 1,
        schedule: (callback) => {
          loop = callback;
          return () => {
            loop = undefined;
          };
        },
        onVisibilityChange: () => () => {},
      },
    },
  );
  runtime.start();
  assert.equal(runtime.roomState()!.stage, "lobby");
  assert.equal(runtime.roomState()!.seats.size, 2);
  now += 100;
  loop!();
  assert.equal(runtime.roomState()!.stage, "lobby");
  assert.equal(runtime.command({ type: "action", action: "start" }), true);
  now += 100;
  loop!();
  assert.equal(runtime.roomState()!.stage, "running");
  runtime.stop();
});
