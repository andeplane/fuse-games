import assert from "node:assert/strict";
import test from "node:test";
import {
  applyMachine,
  createMachine,
  createWorkshop,
  FREE_WORKSHOP,
  PUZZLES,
  stepMachine,
  stepPhysics,
  validMachine,
  validCommand,
  validWorkshopBlueprint,
  type Machine,
  type Part,
  type PartKind,
  type MachineLink,
  type MachineCommand,
} from "../src/game/machine.js";

type Placement = [PartKind, number, number, boolean?];
/** Each solution goes through the same edit and run commands as a player's bench. */
const recipes: Placement[][] = [
  [["ramp", 160, 140]],
  [["ramp", 450, 140, true]],
  [["belt", 180, 182]],
  [["fan", 102, 280]],
  [["ramp", 340, 140]],
  [["ramp", 160, 140]],
  [
    ["gear", 280, 216],
    ["driveBelt", 334, 216],
  ],
  [["lens", 224, 242]],
  [
    ["belt", 180, 220],
    ["belt", 274, 228],
  ],
  [["elbow", 160, 160]],
  [
    ["rope", 220, 250],
    ["rope", 238, 138],
    ["eyelet", 264, 108],
  ],
  [["ramp", 246, 148]],
];
function edit(machine: Machine, command: MachineCommand) {
  assert.ok(applyMachine(machine, command), JSON.stringify(command));
}
function simulate(machine: Machine) {
  edit(machine, { type: "run" });
  for (let i = 0; i < 600 && machine.mode === "running"; i++) {
    stepMachine(machine);
    assert.ok(
      validMachine(machine),
      `invalid machine at physics tick ${machine.tick}`,
    );
  }
  return machine.mode;
}
for (const [i, recipe] of recipes.entries()) {
  test(`Puzzle ${i + 1}: ${PUZZLES[i]!.title} needs a build and accepts its solution`, () => {
    assert.equal(simulate(createMachine(i)), "failed");
    const machine = createMachine(i);
    for (const [kind, x, y, flip] of recipe) {
      edit(machine, { type: "place", kind, x, y });
      if (flip) edit(machine, { type: "flip", id: machine.parts.at(-1)!.id });
    }
    assert.equal(simulate(machine), "solved");
    edit(machine, { type: "rewind" });
    assert.equal(machine.mode, "build");
    assert.equal(machine.tick, 0);
    assert.equal(simulate(machine), "solved");
  });
}
const piece = (
  id: number,
  kind: PartKind,
  x: number,
  y: number,
  extra: Partial<Part> = {},
): Part => ({ id, kind, x, y, flip: false, fixed: false, ...extra });
const workshop = (parts: Part[], links: MachineLink[] = []) =>
  createWorkshop({ air: 67, gravity: 272, parts, links });

test("DOS bowling drop and brick contact reproduce measured positions and velocities", () => {
  const free = workshop([piece(1, "bowling", 80, 116)]);
  edit(free, { type: "run" });
  const positions = new Map([
    [1, 100],
    [2, 101],
    [3, 103],
    [4, 105],
    [5, 107],
    [6, 111],
    [10, 128],
    [20, 210],
    [35, 430],
    [36, 449],
    [37, 468],
    [45, 620],
  ]);
  for (let tick = 1; tick <= 45; tick++) {
    stepPhysics(free);
    const b = free.bodies[0]!;
    assert.equal(b.vy * 512, Math.min(tick * 269, 9695));
    if (positions.has(tick))
      assert.equal(Math.floor(b.y) - 16, positions.get(tick));
  }
  const floor = workshop([
    piece(1, "bowling", 80, 116),
    piece(2, "wall", 90, 168, { width: 160, height: 16 }),
  ]);
  const samples = new Map<number, [number, number]>([
    [10, [65995, 2690]],
    [11, [66047, -1415]],
    [12, [64901, -1146]],
    [16, [63007, -70]],
    [20, [127, 1006]],
    [21, [66047, -573]],
    [25, [66047, -187]],
    [26, [66047, 0]],
    [45, [66047, 0]],
  ]);
  edit(floor, { type: "run" });
  for (let tick = 1; tick <= 45; tick++) {
    stepPhysics(floor);
    const b = floor.bodies[0]!;
    const sample = samples.get(tick);
    if (sample) {
      assert.equal(b.vy * 512, sample[1]);
      assert.equal((b.x - 16) * 512, tick === 10 ? 32768 : 33279);
      assert.equal(
        tick === 20 ? Math.floor(b.y) - 16 : (b.y - 16) * 512,
        sample[0],
      );
    }
  }
});
test("source balloon and ball materials accelerate on their fixed lattice", () => {
  for (const [kind, ay] of [
    ["balloon", -198],
    ["basketball", 266],
    ["baseball", 268],
    ["tennis", 266],
  ] as const) {
    const m = workshop([piece(1, kind, 160, 160)]);
    edit(m, { type: "run" });
    for (let t = 1; t <= 10; t++) {
      stepPhysics(m);
      assert.equal(m.bodies[0]!.vy * 512, ay * t);
      assert.equal((m.bodies[0]!.y - 160) * 512, (ay * t * (t + 1)) / 2);
    }
  }
});
test("one second of room ticks preserves the DOS clock phase across restore", () => {
  const m = workshop([piece(1, "bowling", 160, 60)]);
  edit(m, { type: "run" });
  for (let i = 0; i < 20; i++) stepMachine(m);
  assert.equal(m.tick, 29);
  assert.equal(m.phase, (20 * 1193182) % (5041 * 8 * 20));
  const restored: unknown = JSON.parse(JSON.stringify(m));
  assert.ok(validMachine(restored));
  for (let i = 0; i < 40; i++) {
    stepMachine(m);
    stepMachine(restored);
  }
  assert.deepEqual(m, restored);
});
test("the reference switch, motor flip and belt matrix determines conveyor direction", () => {
  for (const power of [false, true])
    for (const flip of [false, true])
      for (const coupled of [false, true]) {
        const parts = [
          piece(1, "outlet", 70, 120),
          piece(2, "motor", 320, 210, { flip }),
          piece(3, "belt", 440, 210),
          piece(4, "bowling", 440, 164),
          piece(5, "ball", power ? 70 : 200, 100),
        ];
        const links: MachineLink[] = [{ kind: "wire", a: 1, b: 2 }];
        if (coupled) links.push({ kind: "belt", a: 2, b: 3 });
        const m = workshop(parts, links);
        edit(m, { type: "run" });
        let landed = false;
        for (let i = 0; i < 40; i++) {
          stepPhysics(m);
          if (m.bodies[0]!.y >= 184) {
            landed = true;
            break;
          }
        }
        assert.ok(landed);
        assert.equal(m.active.includes(2), power);
        assert.equal(
          m.bodies[0]!.vx * 512,
          power && coupled ? (flip ? 4096 : -4096) : 0,
        );
      }
});
test("plugging a lamp or fan into its own switch isolates each circuit", () => {
  const parts = [
    piece(1, "switch", 50, 80),
    piece(2, "outlet", 420, 300),
    piece(3, "bulb", 500, 180),
    piece(4, "fan", 100, 180),
    piece(5, "ball", 50, 64),
    piece(6, "tennis", 166, 160),
  ];
  const m = workshop(parts, [
    { kind: "wire", a: 1, b: 3 },
    { kind: "wire", a: 2, b: 4 },
  ]);
  edit(m, { type: "run" });
  for (let i = 0; i < 18; i++) stepPhysics(m);
  assert.ok(m.active.includes(3));
  assert.ok(!m.active.includes(4));
  assert.equal(m.bodies[1]!.x, 166);
});
test("an incoming heavy ball transfers motion to a lighter ball", () => {
  const m = workshop([
    piece(1, "bowling", 150, 60),
    piece(2, "tennis", 166, 120),
    piece(3, "shelf", 180, 135),
  ]);
  edit(m, { type: "run" });
  for (let i = 0; i < 30; i++) stepPhysics(m);
  assert.ok(m.bodies[1]!.x > 180);
});
test("a pull cord holds a rising balloon against a fixed anchor and rewind restores a cut cord", () => {
  const layout = [piece(1, "balloon", 160, 140), piece(2, "eyelet", 160, 260)];
  const links: MachineLink[] = [{ kind: "rope", a: 1, b: 2 }];
  const held = workshop(layout, links);
  edit(held, { type: "run" });
  for (let i = 0; i < 30; i++) stepPhysics(held);
  assert.equal(held.bodies[0]!.y, 140);
  assert.deepEqual(held.active, [1, 2]);
  const cut = workshop(
    [...layout, piece(3, "scissors", 160, 200), piece(4, "baseball", 184, 158)],
    links,
  );
  edit(cut, { type: "run" });
  for (let i = 0; i < 35; i++) stepPhysics(cut);
  assert.deepEqual(cut.broken, [0]);
  assert.ok(cut.bodies[0]!.y < 100);
  const snapshot: unknown = JSON.parse(JSON.stringify(cut));
  assert.ok(validMachine(snapshot));
  stepPhysics(snapshot);
  stepPhysics(cut);
  assert.deepEqual(snapshot, cut);
  edit(cut, { type: "rewind" });
  assert.deepEqual(cut.broken, []);
  assert.deepEqual(cut.links, links);
});
test("a cord sliding over its guide transfers weight to the other leg", () => {
  const m = workshop(
    [
      piece(1, "crate", 140, 224),
      piece(2, "pulley", 140, 120),
      piece(3, "pulley", 220, 120),
      piece(4, "balloon", 220, 224),
    ],
    [
      { kind: "rope", a: 1, b: 2 },
      { kind: "rope", a: 2, b: 3 },
      { kind: "rope", a: 3, b: 4 },
    ],
  );
  edit(m, { type: "run" });
  for (let i = 0; i < 12; i++) stepPhysics(m);
  const [weight, balloon] = m.bodies;
  assert.ok(weight!.y > 224 && balloon!.y < 224);
  assert.ok(Math.abs(weight!.y + balloon!.y - 448) < 0.005);
});
test("edits consume stock, cannot move a fixture and restore connections through undo", () => {
  const m = createMachine(0);
  assert.equal(applyMachine(m, { type: "move", id: 1, x: 20, y: 20 }), false);
  edit(m, { type: "place", kind: "ramp", x: 160, y: 140 });
  assert.equal(
    applyMachine(m, { type: "place", kind: "ramp", x: 240, y: 160 }),
    false,
  );
  const free = workshop([
    piece(1, "switch", 40, 40),
    piece(2, "motor", 200, 90),
  ]);
  edit(free, { type: "connect", kind: "wire", a: 2, b: 1 });
  assert.deepEqual(free.links, [{ kind: "wire", a: 1, b: 2 }]);
  edit(free, { type: "remove", id: 2 });
  assert.deepEqual(free.links, []);
  edit(free, { type: "undo" });
  assert.equal(free.links.length, 1);
  assert.ok(validMachine(free));
});
test("freeform is unscored; restart and rewind preserve independent editable copies", () => {
  const m = createMachine(FREE_WORKSHOP);
  edit(m, { type: "place", kind: "ball", x: 180, y: 80 });
  edit(m, { type: "run" });
  const layout = structuredClone(m.parts);
  for (let i = 0; i < 800; i++) stepMachine(m);
  assert.equal(m.mode, "running");
  assert.deepEqual(m.parts, layout);
  assert.ok(validMachine(m));
  edit(m, { type: "rewind" });
  assert.deepEqual(m.bodies, []);
  assert.deepEqual(m.parts, layout);
});
test("untrusted commands, forged stock, body IDs and excessive history fail validation", () => {
  assert.equal(
    validCommand({ type: "place", kind: "__proto__", x: 200, y: 100 }),
    false,
  );
  assert.equal(validCommand({ type: "move", id: 0, x: 1, y: 2 }), false);
  assert.equal(validCommand({ type: "undo", garbage: 1 }), false);
  const m = createMachine(0);
  assert.equal(
    validMachine({ ...m, parts: [...m.parts, piece(3, "crate", 100, 100)] }),
    false,
  );
  assert.equal(
    validMachine({ ...m, undo: Array.from({ length: 100 }, () => []) }),
    false,
  );
  edit(m, { type: "run" });
  assert.equal(
    validMachine({ ...m, bodies: [{ ...m.bodies[0], id: 2 }] }),
    false,
  );
  assert.equal(
    validMachine({ ...m, parts: m.parts.map((p) => ({ ...p, fixed: false })) }),
    false,
  );
  assert.equal(
    validWorkshopBlueprint({
      air: 67,
      gravity: 272,
      parts: Array(129).fill(piece(1, "ball", 20, 20)),
      links: [],
    }),
    false,
  );
});
