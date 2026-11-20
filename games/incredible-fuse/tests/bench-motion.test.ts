import assert from "node:assert/strict";
import test from "node:test";
import { spritePose } from "../src/app/bench-board.js";
import {
  applyMachine,
  createMachine,
  FREE_WORKSHOP,
  stepPhysics,
  type MachineCommand,
} from "../src/game/machine.js";

test("fans and conveyor artwork move only when driven and face the powered shaft's travel", () => {
  for (const connected of [false, true])
    for (const powered of [false, true])
      for (const flipped of [false, true]) {
        const machine = createMachine(FREE_WORKSHOP);
        const edit = (command: MachineCommand) =>
          assert.ok(applyMachine(machine, command), JSON.stringify(command));
        edit({ type: "place", kind: "outlet", x: 70, y: 120 });
        edit({ type: "place", kind: "motor", x: 320, y: 210 });
        edit({ type: "place", kind: "belt", x: 440, y: 210 });
        edit({ type: "place", kind: "fan", x: 150, y: 290 });
        edit({ type: "place", kind: "ball", x: powered ? 70 : 210, y: 100 });
        const [, motor, belt, fan] = machine.parts;
        assert.ok(motor && belt && fan);
        if (flipped) edit({ type: "flip", id: motor.id });
        if (connected) {
          edit({ type: "connect", kind: "wire", a: 1, b: motor.id });
          edit({ type: "connect", kind: "wire", a: 1, b: fan.id });
          edit({ type: "connect", kind: "belt", a: motor.id, b: belt.id });
        }
        edit({ type: "run" });
        for (let i = 0; i < 16; i++) stepPhysics(machine);
        const moving = powered && connected;
        const fanPose = spritePose(machine, fan),
          beltPose = spritePose(machine, belt);
        assert.equal(fanPose.blowing, moving);
        assert.equal(fanPose.motion > 0, moving);
        assert.equal(beltPose.active, moving);
        assert.equal(beltPose.motion > 0, moving);
        if (moving) assert.equal(beltPose.face, !flipped);
      }
});
