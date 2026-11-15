import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  CLASSIC_PHYSICS,
  LEFT,
  RIGHT,
  UP,
  DOWN,
  JUMP,
  FIRE,
  ROPE,
  NEXT,
  PREV,
  CARVE,
  SLOT1,
  SLOT5,
  SELECT_MOD,
  STRAFE,
  stepWorm,
  stepWormWithControls,
  stepClassicControls,
  stepClassicMovement,
  stepClassicAim,
  checkOnGround,
  shootRope,
  stepClassicRope,
  ropeForce,
  faceDirection,
  seconds,
  f,
  type PhysicsWorm,
  type PhysicsTerrainPort,
} from "../src/engine/classic/physics.js";

const AIR = { wormPass: true, particlePass: true, canHook: true };
const ROCK = { wormPass: false, particlePass: false, canHook: true };
class Terrain implements PhysicsTerrainPort {
  readonly width = 640;
  readonly height = 480;
  carves: { x: number; y: number; radius: number }[] = [];
  material(x: number, y: number) {
    return x < 0 ||
      x >= 640 ||
      y < 0 ||
      y >= 480 ||
      y >= 300 ||
      y <= 20 ||
      x >= 500
      ? ROCK
      : AIR;
  }
  carve(x: number, y: number, radius: number) {
    this.carves.push({ x, y, radius });
    return 0;
  }
}
function worm(overrides: Partial<PhysicsWorm> = {}): PhysicsWorm {
  return {
    id: "0",
    x: 100,
    y: 295,
    vx: 0,
    vy: 0,
    aim: 0,
    facing: 1,
    moveFacing: 1,
    aimSpeed: 0,
    onGround: true,
    input: 0,
    health: 100,
    alive: true,
    rope: null,
    ...overrides,
  };
}
const work = mkdtempSync(join(tmpdir(), "fusero-native-")),
  binary = join(work, "reference");
before(() => {
  const fixture = fileURLToPath(
    new URL("fixtures/classic-native.cpp", import.meta.url),
  );
  const compiled = spawnSync(
    "c++",
    ["-std=c++17", "-O0", "-ffp-contract=off", fixture, "-o", binary],
    { encoding: "utf8" },
  );
  assert.equal(compiled.status, 0, compiled.stderr);
});
after(() => rmSync(work, { recursive: true, force: true }));
function native(initial: PhysicsWorm, inputs: number[]): number[][] {
  const header = [
    initial.x,
    initial.y,
    initial.vx,
    initial.vy,
    initial.aim,
    initial.facing,
    initial.moveFacing,
    Number(initial.onGround),
  ].join(" ");
  const result = spawnSync(binary, [], {
    input: header + "\n" + inputs.join("\n") + "\n",
    encoding: "utf8",
    maxBuffer: 8 * 1024 * 1024,
  });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as number[]);
}
function compareNative(initial: PhysicsWorm, inputs: number[]): void {
  const expected = native(initial, inputs),
    terrain = new Terrain(),
    other = worm({ id: "1", x: 250, y: 150, onGround: false });
  const current = structuredClone(initial);
  for (const [index, input] of inputs.entries()) {
    stepWorm(current, [current, other], terrain, input);
    const rope = current.rope;
    const actual = [
      current.x,
      current.y,
      current.vx,
      current.vy,
      current.aim,
      current.aimSpeed,
      Number(current.onGround),
      Number(!!rope),
      Number(rope?.state === "shooting"),
      Number(rope?.state === "terrain" || rope?.state === "worm"),
    ];
    for (const [field, value] of actual.entries()) {
      const reference = f(expected[index]![field]!);
      assert.ok(
        Math.abs(value - reference) <= 0.00002,
        `step${index} field${field}: TS${value}, native${reference}`,
      );
    }
    if (rope) {
      for (const [offset, value] of [
        rope.x,
        rope.y,
        rope.vx,
        rope.vy,
        rope.attachedId === null ? -1 : Number(rope.attachedId),
      ].entries()) {
        const reference = f(expected[index]![10 + offset]!);
        assert.ok(
          Math.abs(value - reference) <= 0.00005,
          `step${index} rope${offset}: TS${value}, native${reference}`,
        );
      }
    }
  }
}
test("native source-extracted walking, stopping, strafing and jump trajectories agree", () => {
  compareNative(
    worm(),
    Array.from({ length: 500 }, (_, i) =>
      i < 90
        ? RIGHT
        : i < 150
          ? 0
          : i < 240
            ? LEFT | STRAFE
            : i === 240
              ? JUMP
              : i < 330
                ? RIGHT
                : 0,
    ),
  );
});
test("native source-extracted ceiling/wall collision and high-speed subdivision agree", () => {
  compareNative(
    worm({ x: 490, y: 150, vx: 200, vy: -20, onGround: false }),
    Array(200).fill(0),
  );
  compareNative(
    worm({ x: 100, y: 30, vy: -100, onGround: false }),
    Array(200).fill(0),
  );
  // 1000px/s over11ms exceeds the native squared-displacement threshold10,
  // forcing recursive float subdivisions11→5.5→2.75ms in the extracted C++.
  compareNative(
    worm({ x: 100, y: 150, vx: 1000, vy: 0, onGround: false }),
    Array(80).fill(0),
  );
});
test("native source-extracted modern accelerated aim and clamped endpoints agree", () => {
  compareNative(
    worm(),
    Array.from({ length: 240 }, (_, i) =>
      i < 60 ? UP : i < 90 ? 0 : i < 160 ? DOWN : i < 180 ? 0 : UP,
    ),
  );
});
test("native source-extracted rope flight, terrain pull, release persistence and rethrow agree", () => {
  compareNative(
    worm({ x: 450, y: 150, onGround: false }),
    Array.from({ length: 180 }, (_, i) =>
      i === 0 || i === 90 ? ROPE : i === 150 ? JUMP : 0,
    ),
  );
});
test("native source-extracted falling hook and worm attachment agree", () => {
  compareNative(
    worm({ x: 100, y: 50, onGround: false }),
    Array.from({ length: 180 }, (_, i) => (i === 0 ? ROPE : 0)),
  );
  compareNative(
    worm({ x: 210, y: 150, onGround: false }),
    Array.from({ length: 120 }, (_, i) => (i === 0 ? ROPE : 0)),
  );
});
test("Classic defaults and float time preserve the actual mod overrides", () => {
  assert.equal(CLASSIC_PHYSICS.gravity, 100);
  assert.equal(CLASSIC_PHYSICS.jumpForce, -65);
  assert.equal(CLASSIC_PHYSICS.ropeRestLength, 27);
  assert.equal(CLASSIC_PHYSICS.ropeStrength, 4.5);
  assert.equal(seconds(11), f(11 * f(0.001)));
  assert.notEqual(seconds(11), f(0.011));
});
test("worm and rope recursive float seconds retain fractional milliseconds", () => {
  const current = worm({ x: 100, y: 150, vx: 1000, vy: 0, onGround: false }),
    terrain = new Terrain();
  stepWorm(current, [current], terrain, 0);
  // Truncating each native float half to integer milliseconds would only move10px.
  assert.equal(current.x, 111);
  const owner = worm({ x: 200, y: 150, onGround: false });
  shootRope(owner);
  stepClassicRope(owner, [owner], terrain, seconds(11));
  // 250px/s triggers the rope's separate precision threshold5 on its first step.
  assert.equal(owner.rope!.x, 202.75);
});
test("outer input-clock10/20ms aim intervals do not change native11ms motion", () => {
  const short = worm(),
    long = worm(),
    terrain = new Terrain();
  stepWorm(short, [short], terrain, RIGHT | UP, 11, undefined, 10);
  stepWorm(long, [long], terrain, RIGHT | UP, 11, undefined, 20);
  assert.deepEqual(
    [short.x, short.y, short.vx, short.vy],
    [long.x, long.y, long.vx, long.vy],
  );
  // During initial acceleration, doubling input time doubles aim speed and
  // quadruples its integrated angle while physical displacement stays fixed.
  assert.equal(long.aimSpeed, short.aimSpeed * 2);
  assert.equal(long.aim, short.aim * 4);
  const angle = long.aim,
    speed = long.aimSpeed,
    x = long.x;
  stepWorm(long, [long], terrain, RIGHT | UP, 11, undefined, 0);
  assert.equal(long.aim, angle);
  assert.equal(long.aimSpeed, speed);
  assert.ok(
    long.x > x,
    "a same-outer-time catch-up still advances native physics",
  );
});
test("disabled input clears controls without pausing existing motion or rope flight", () => {
  const current = worm({
      x: 100,
      y: 150,
      vx: 20,
      aim: -20,
      aimSpeed: 30,
      input: RIGHT | UP,
      onGround: false,
    }),
    terrain = new Terrain();
  shootRope(current);
  const hook = current.rope!.x,
    angle = current.aim,
    aimSpeed = current.aimSpeed;
  const controls = stepWorm(
    current,
    [current],
    terrain,
    RIGHT | UP | FIRE | JUMP | NEXT | CARVE,
    11,
    undefined,
    20,
    false,
  );
  assert.deepEqual(controls, {
    move: false,
    jump: false,
    carve: false,
    shoot: false,
    weaponDelta: 0,
    weaponSlot: null,
  });
  assert.equal(current.input, 0);
  assert.equal(current.aim, angle);
  assert.equal(current.aimSpeed, aimSpeed);
  assert.ok(current.x > 100);
  assert.ok(current.y > 150);
  assert.equal(terrain.carves.length, 0);
  assert.ok(current.rope);
  assert.ok(current.rope.x > hook);
});
test("rope button is press/rethrow, release keeps rope, jump detaches instead of reeling", () => {
  const current = worm({ x: 200, y: 150, onGround: false }),
    terrain = new Terrain();
  stepWorm(current, [current], terrain, ROPE);
  assert.ok(current.rope);
  const first = current.rope;
  stepWorm(current, [current], terrain, 0);
  assert.equal(current.rope, first);
  stepWorm(current, [current], terrain, ROPE);
  assert.notEqual(current.rope, first);
  stepWorm(current, [current], terrain, JUMP);
  assert.equal(current.rope, null);
});
test("attached rope pulls with constant 450 acceleration beyond 27px and no force inside", () => {
  const current = worm({
    x: 100,
    y: 100,
    rope: { x: 200, y: 100, vx: 0, vy: 0, state: "terrain", attachedId: null },
  });
  assert.deepEqual(ropeForce(current), { x: 450, y: -0 });
  current.rope!.x = 126;
  assert.deepEqual(ropeForce(current), { x: 0, y: 0 });
  current.rope!.x = 127;
  assert.equal(ropeForce(current).x, 450);
});
test("dead hooked worm detaches, but a living zero-HP worm remains hookable", () => {
  const current = worm({ x: 200, y: 150, onGround: false }),
    target = worm({
      id: "1",
      x: 204,
      y: 150,
      health: 0,
      alive: true,
      onGround: false,
    }),
    terrain = new Terrain();
  shootRope(current);
  stepClassicRope(current, [current, target], terrain, seconds(11));
  assert.equal(current.rope!.attachedId, target.id);
  target.alive = false;
  stepClassicRope(current, [current, target], terrain, seconds(11));
  assert.equal(current.rope!.state, "falling");
  assert.equal(current.rope!.attachedId, null);
});
test("keyboard movement turns facing while strafe preserves aim side and move direction", () => {
  const current = worm();
  stepClassicControls(current, LEFT | STRAFE);
  assert.equal(current.facing, 1);
  assert.equal(current.moveFacing, -1);
  stepClassicControls(current, LEFT);
  assert.equal(current.facing, -1);
  stepClassicControls(current, LEFT | RIGHT);
  assert.equal(current.moveFacing, -1);
  stepClassicControls(current, 0);
  const control = stepClassicControls(current, SELECT_MOD | RIGHT);
  assert.equal(control.move, false);
  assert.equal(control.weaponDelta, 1);
});
test("weapon controls support five direct slots, previous/next and no held repeats", () => {
  const current = worm();
  assert.equal(stepClassicControls(current, NEXT).weaponDelta, 1);
  assert.equal(stepClassicControls(current, NEXT).weaponDelta, 0);
  assert.equal(stepClassicControls(current, PREV | FIRE).weaponDelta, -1);
  assert.equal(stepClassicControls(current, SLOT5).weaponSlot, 4);
  assert.equal(stepClassicControls(current, SLOT1).weaponSlot, 0);
});
test("direction chord carving uses move direction, not strafing face direction", () => {
  const current = worm(),
    terrain = new Terrain();
  stepWorm(current, [current], terrain, LEFT | STRAFE);
  stepWorm(current, [current], terrain, LEFT | RIGHT | STRAFE);
  assert.equal(terrain.carves.length, 1);
  assert.ok(terrain.carves[0]!.x < current.x);
  assert.equal(terrain.carves[0]!.radius, 4);
  stepWorm(current, [current], terrain, CARVE);
  assert.equal(terrain.carves.length, 2);
});
test("aim has source acceleration, immediate default release friction and 150-degree span", () => {
  const current = worm();
  stepClassicAim(current, UP);
  assert.ok(current.aim < 0);
  assert.ok(current.aimSpeed < 0);
  const aim = current.aim;
  stepClassicAim(current, 0);
  assert.equal(current.aimSpeed, 0);
  assert.equal(current.aim, aim);
  for (let i = 0; i < 100; i++) stepClassicAim(current, DOWN);
  assert.equal(current.aim, 60);
  for (let i = 0; i < 100; i++) stepClassicAim(current, UP);
  assert.equal(current.aim, -90);
  current.aim = 0;
  current.facing = -1;
  assert.deepEqual(faceDirection(current), { x: -1, y: 0 });
});
test("ground acceleration is conditional, not a hard momentum clamp, and zero HP still moves", () => {
  const current = worm({ health: 0, vx: 29 }),
    terrain = new Terrain();
  assert.equal(checkOnGround(current, terrain), true);
  const control = stepClassicControls(current, RIGHT);
  stepClassicMovement(current, terrain, control);
  assert.ok(current.vx > 30);
  assert.ok(current.x > 100);
});

test("native bot controls share motion but jumping preserves its rope", () => {
  const terrain = new Terrain(),
    current = worm();
  current.rope = {
    x: 100,
    y: 30,
    vx: 0,
    vy: 0,
    state: "terrain",
    attachedId: null,
  };
  const controls = {
    move: false,
    jump: true,
    carve: false,
    shoot: false,
    weaponDelta: 0,
    weaponSlot: null,
  };
  stepWormWithControls(current, [current], terrain, controls);
  assert.ok(
    current.rope,
    "CWormBot::AI_Jump never performs human jump's rope Clear",
  );
  assert.ok(
    current.vy < 0,
    "shared ground/jump kernel still applies the native jump force",
  );
  const human = worm();
  human.rope = {
    x: 100,
    y: 30,
    vx: 0,
    vy: 0,
    state: "terrain",
    attachedId: null,
  };
  stepWorm(human, [human], terrain, JUMP);
  assert.equal(
    human.rope,
    null,
    "CWormHuman detaches before the common motion kernel",
  );
  assert.equal(
    current.aim,
    0,
    "no keyboard aim acceleration is introduced by shared motion",
  );
});
