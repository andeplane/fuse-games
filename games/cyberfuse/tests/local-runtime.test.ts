import assert from "node:assert/strict";
import test from "node:test";
import type { RuntimeDependencies } from "fuse-netcode";
import { CyberfuseRuntime } from "../src/app/runtime.js";
import {
  DEFAULT_SETTINGS,
  LEFT,
  RIGHT,
  FIRE,
  SPECIAL,
} from "../src/game/index.js";

function localRoom(online = false) {
  let now = 0,
    hidden = false,
    serial = 0;
  let tick = () => {},
    visibility = () => {};
  const deps: RuntimeDependencies = {
    now: () => now,
    hidden: () => hidden,
    generation: () => 1,
    token: () => "match-" + ++serial,
    schedule(fn) {
      tick = fn;
      return () => {
        tick = () => {};
      };
    },
    onVisibilityChange(fn) {
      visibility = fn;
      return () => {
        visibility = () => {};
      };
    },
  };
  const game = new CyberfuseRuntime(
    "LOCAL",
    DEFAULT_SETTINGS,
    {
      state() {},
      ready() {},
      event() {},
      status() {},
      ended() {},
    },
    {
      dependencies: deps,
      autoStartSolo: false,
      ...(online
        ? {
            transport: (events: import("fuse-netcode").TransportEvents) => ({
              id: "host",
              hostId: "host",
              sentBytes: 0,
              connect: () => events.welcome("host", "host"),
              close() {},
              send: () => true,
              sendFast: () => true,
              linked: () => false,
              explain: () => "one-seat room",
              stats: async () => ({ direct: 0, relayed: 0, buffered: 0 }),
            }),
          }
        : { localPlayers: ["Blue", "Red"] }),
    },
  );

  game.start();
  return {
    game,
    advance(ms: number) {
      for (let i = 0; i < ms; i += 10) {
        now += 10;
        tick();
      }
    },
    visibility(value: boolean) {
      hidden = value;
      visibility();
    },
    begin() {
      assert.ok(game.command({ type: "action", action: "start" }));
      this.advance(100);
    },
  };
}
test("two local operatives use their own held keys, equipment, and ordinary input streams", () => {
  const setup = localRoom(),
    rt = setup.game,
    [p1, p2] = rt.localPlayerIds;
  assert.ok(p1 && p2);
  assert.ok(rt.equip([4]));
  assert.ok(rt.localEquip(p2, [1]));
  setup.advance(75);
  setup.begin();
  const initial = rt.roomState()!.world!;
  const a = initial.actors.find((a) => a.seat === p1)!,
    b = initial.actors.find((a) => a.seat === p2)!;
  assert.deepEqual(a.inventory, [4]);
  assert.deepEqual(b.inventory, [1]);
  rt.input(LEFT | FIRE);
  assert.ok(rt.localInput(p2, RIGHT | SPECIAL));
  assert.equal(rt.localInput("another-peer", LEFT), false);
  setup.advance(70);
  assert.equal(rt.roomState()!.held[p1]?.bits, LEFT | FIRE);
  assert.equal(rt.roomState()!.held[p2]?.bits, RIGHT | SPECIAL);
  rt.input(0);
  setup.advance(70);
  assert.equal(rt.roomState()!.held[p1]?.bits, 0);
  assert.equal(rt.roomState()!.held[p2]?.bits, RIGHT | SPECIAL);
  rt.stop();
});
test("solo inspection freezes every operative and composes with hidden-tab time in both orders", () => {
  const setup = localRoom(),
    rt = setup.game;
  setup.begin();
  rt.input(FIRE);
  rt.localInput(rt.localPlayerIds[1]!, RIGHT);
  setup.advance(100);
  rt.setInspectionPaused(true);
  const paused = rt.roomState()!.world!.tick;
  assert.ok(Object.values(rt.roomState()!.held).every((c) => c.bits === 0));
  setup.advance(600);
  setup.visibility(true);
  setup.advance(300);
  setup.visibility(false);
  setup.advance(1500);
  assert.equal(rt.roomState()!.world!.tick, paused);
  assert.equal(rt.localInput(rt.localPlayerIds[1]!, RIGHT), false);
  setup.visibility(true);
  rt.setInspectionPaused(false);
  setup.advance(1500);
  assert.equal(rt.roomState()!.world!.tick, paused);
  setup.visibility(false);
  setup.advance(150);
  const after = rt.roomState()!.world!.tick;
  assert.ok(after > paused && after - paused <= 12);
  assert.ok(Object.values(rt.roomState()!.held).every((c) => c.bits === 0));
  rt.stop();
});

test("an online inspection releases the host's controls and the shared mission clock continues", () => {
  const setup = localRoom(true),
    rt = setup.game;
  assert.ok(rt.command({ type: "join", name: "Blue", slot: 0 }));
  setup.advance(100);
  setup.begin();
  rt.input(FIRE);
  setup.advance(100);
  assert.equal(rt.roomState()!.held.host?.bits, FIRE);
  const before = rt.roomState()!.world!.tick;
  rt.setInspectionPaused(true);
  setup.advance(600);
  assert.equal(rt.roomState()!.held.host?.bits, 0);
  assert.ok(rt.roomState()!.world!.tick > before + 20);
  assert.equal(rt.localInput("host", RIGHT), false);
  rt.setInspectionPaused(false);
  rt.input(RIGHT);
  setup.advance(100);
  assert.equal(rt.roomState()!.held.host?.bits, RIGHT);
  rt.stop();
});
