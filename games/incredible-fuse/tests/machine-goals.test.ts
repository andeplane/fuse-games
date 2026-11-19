import assert from "node:assert/strict";
import test from "node:test";
import {
  applyMachine,
  createMachine,
  PUZZLES,
  stepPhysics,
  validMachine,
  type MachineCommand,
} from "../src/game/machine.js";
import {
  evaluateObjective,
  GOAL_PUZZLES,
  type MachineObjective,
} from "../src/game/machine-goals.js";

const solutions: Record<string, MachineCommand> = {
  "Double booking": { type: "place", kind: "ramp", x: 160, y: 140 },
  "Fragile freight": { type: "place", kind: "shelf", x: 420, y: 290 },
  "Quiet carriage": { type: "place", kind: "ramp", x: 160, y: 140 },
};

for (const puzzle of GOAL_PUZZLES) {
  test(`${puzzle.title} fails untouched and wins through workshop edits, including after restore`, () => {
    const index = PUZZLES.indexOf(puzzle);
    const machine = createMachine(index);
    assert.equal(applyMachine(machine, { type: "run" }), true);
    for (let i = 0; i <= 600 && machine.mode === "running"; i++)
      stepPhysics(machine);
    assert.equal(machine.mode, "failed");
    assert.equal(applyMachine(machine, { type: "rewind" }), true);
    assert.equal(applyMachine(machine, solutions[puzzle.title]!), true);
    assert.equal(applyMachine(machine, { type: "run" }), true);
    for (let i = 0; i < 10; i++) stepPhysics(machine);
    const restored = structuredClone(machine);
    assert.ok(validMachine(restored));
    for (let i = 0; i <= 600 && restored.mode === "running"; i++) {
      stepPhysics(machine);
      stepPhysics(restored);
    }
    assert.equal(restored.mode, "solved");
    assert.ok(validMachine(restored));
    assert.deepEqual(restored, machine);
  });
}

test("a quota counts only eligible body centers inside the zone on this tick", () => {
  const goal: MachineObjective = {
    kind: "quota",
    region: { x: 10, y: 10, width: 20, height: 20 },
    candidates: [1, 2],
    count: 2,
  };
  const body = (id: number, x: number) => ({ id, x, y: 20, vx: 0, vy: 0 });
  const run = (positions: [number, number][]) =>
    evaluateObjective(goal, {
      tick: 6,
      active: [],
      bodies: positions.map(([id, x]) => body(id, x)),
    });
  assert.equal(
    run([
      [1, 10],
      [2, 31],
      [3, 20],
    ]),
    "running",
  );
  assert.equal(
    run([
      [1, 9],
      [2, 30],
      [3, 20],
    ]),
    "running",
  );
  assert.equal(
    run([
      [1, 10],
      [2, 30],
    ]),
    "solved",
  );
});

test("a forbidden activation or a lost body fails even at the completion boundary", () => {
  const selector: MachineObjective = {
    kind: "select",
    required: [1, 2],
    forbidden: [3],
  };
  const state = { tick: 89, bodies: [], active: [1, 2, 3] };
  assert.equal(evaluateObjective(selector, state), "failed");
  const preserve: MachineObjective = {
    kind: "preserve",
    subjects: [1],
    bounds: { x: 0, y: 0, width: 100, height: 100 },
    untilTick: 89,
  };
  assert.equal(evaluateObjective(preserve, state), "failed");
  const bodies = [{ id: 1, x: 30, y: 50, vx: 0, vy: 0 }];
  assert.equal(
    evaluateObjective(preserve, { ...state, tick: 88, bodies }),
    "running",
  );
  assert.equal(evaluateObjective(preserve, { ...state, bodies }), "solved");
});
