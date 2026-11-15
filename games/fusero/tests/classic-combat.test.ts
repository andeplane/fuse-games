import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  CLASSIC_PROJECTILES,
  CLASSIC_WEAPONS,
} from "../src/engine/classic/catalog.js";
import {
  createWeaponSlots,
  stepWeaponTimers,
  stepClientWeapon,
  fireWeapon,
  prepareWeaponShot,
  processWeaponShot,
} from "../src/engine/classic/weapons.js";
import {
  spawnClassicProjectile,
  stepProjectiles,
} from "../src/engine/classic/projectiles.js";
import { FIXED_RANDOM, fixedRandom } from "../src/engine/classic/random.js";
import type {
  CombatPorts,
  CombatWorld,
  CombatWorm,
  PreparedShot,
} from "../src/engine/classic/combat-types.js";
import {
  createPositionRecorder,
  recordPosition,
  resetPositionRecorder,
  recordedPosition,
} from "../src/engine/classic/history.js";

interface NativeFixture {
  source: string;
  flight: {
    kind: number;
    step: number;
    x: number;
    y: number;
    vx: number;
    vy: number;
  }[];
  cornerBounce: { vx: number; vy: number };
  bazookaChargeAfter500: number;
  grenadeTimerPreSteps: number;
  grenadeTimerLife: number;
  historyPartial: number[];
  historyFull: number[];
  historyCleared: number[];
  bazookaChildren: {
    vx: number;
    vy: number;
    timeVarRandom: number;
    randomIndex: number;
  }[];
  rifleSpawns: {
    seed: number;
    randomIndex: number;
    maxCheck: number;
    avgCheck: number;
    wallShootTime: number;
    flight: { step: number; x: number; y: number; vx: number; vy: number }[];
  }[];
  localLaserFrames: {
    frame: number;
    physicsMs: number;
    shot: boolean;
    pending: number;
    lastFire: number;
    charge: number;
  }[];
}
const native = JSON.parse(
  readFileSync(
    new URL("./fixtures/classic-combat-native.json", import.meta.url),
    "utf8",
  ),
) as NativeFixture;
const id = (name: string) => CLASSIC_WEAPONS.find((w) => w.name === name)!.id;
const descriptor = (name: string) => {
  const w = CLASSIC_WEAPONS[id(name)]!;
  assert.equal(w.type, "projectile");
  if (w.type !== "projectile") throw new Error("not projectile");
  return w.projectileId;
};
function worm(name = "a", x = 100, y = 100): CombatWorm {
  const positionRecordings = createPositionRecorder();
  for (let i = 0; i < 100; i++) recordPosition(positionRecordings, { x, y });
  return {
    id: name,
    x,
    y,
    vx: 0,
    vy: 0,
    aim: 0,
    facing: 1,
    moveFacing: 1,
    aimSpeed: 0,
    onGround: false,
    input: 0,
    health: 100,
    alive: true,
    rope: null,
    weapon: 0,
    positionRecordings,
    slots: createWeaponSlots([
      id("Bazooka"),
      id("Grenade"),
      id("Shotgun"),
      id("Laser"),
      id("Dirt Ball"),
    ]),
  };
}
function world(worms: CombatWorm[] = []): CombatWorld {
  return {
    elapsedMs: 0,
    nextId: 1,
    rng: 71,
    projectiles: [],
    effects: [],
    worms,
  };
}
function arena(
  options: {
    solid?: (x: number, y: number) => boolean;
    dirt?: boolean;
    width?: number;
    height?: number;
  } = {},
) {
  const injuries: { id: string; damage: number; owner: string }[] = [],
    holes: { size: number; x: number; y: number }[] = [],
    placements: { x: number; y: number; green: boolean }[] = [];
  const ports: CombatPorts = {
    width: options.width ?? 4096,
    height: options.height ?? 4096,
    material(x, y) {
      const solid =
        x < 0 ||
        y < 0 ||
        x >= this.width ||
        y >= this.height ||
        !!options.solid?.(x, y);
      return {
        particlePass: !solid,
        destroyable: solid && (options.dirt ?? false),
      };
    },
    carveHole(size, x, y) {
      holes.push({ size, x, y });
      return 3;
    },
    placeDirt(x, y, green) {
      placements.push({ x, y, green });
      return 5;
    },
    injure(id, damage, owner) {
      injuries.push({ id, damage, owner });
    },
  };
  return { ports, injuries, holes, placements };
}
function advance(w: CombatWorld, ports: CombatPorts, steps: number): void {
  for (let i = 0; i < steps; i++) {
    w.elapsedMs += 11;
    stepProjectiles(w, w.worms, ports);
  }
}

test("native projectile fixed randomness is the complete upstream float32 table", () => {
  assert.equal(FIXED_RANDOM.length, 256);
  assert.equal(fixedRandom(0), Math.fround(-0.620216));
  assert.equal(fixedRandom(255), Math.fround(-0.489776));
  assert.equal(fixedRandom(256), fixedRandom(0));
});
test("native position-history cursor, fallback and respawn stale slots match the C++ header", () => {
  const partial = createPositionRecorder();
  for (const x of [10, 20, 30]) recordPosition(partial, { x, y: 0 });
  assert.deepEqual(
    [0, 11, 22, 33].map((ms) => recordedPosition(partial, ms).x),
    native.historyPartial,
  );
  const full = createPositionRecorder();
  for (let x = 0; x < 100; x++) recordPosition(full, { x, y: 0 });
  assert.deepEqual(
    [0, 11, 1089, 1100].map((ms) => recordedPosition(full, ms).x),
    native.historyFull,
  );
  resetPositionRecorder(full, { x: 500, y: 0 });
  assert.deepEqual(
    [0, 11].map((ms) => recordedPosition(full, ms).x),
    native.historyCleared,
  );
});
test("selected-only charge and cooldown follow native float32 reference", () => {
  const w = worm();
  w.slots[0]!.reloading = true;
  w.slots[0]!.charge = 0;
  w.slots[0]!.lastFire = 0.001;
  for (let i = 0; i < 500; i++) stepWeaponTimers(w);
  assert.equal(w.slots[0]!.charge, native.bazookaChargeAfter500);
  assert.ok(w.slots[0]!.lastFire < 0);
  const frozen = { ...w.slots[0]! };
  w.weapon = 1;
  for (let i = 0; i < 300; i++) stepWeaponTimers(w);
  assert.deepEqual(w.slots[0], frozen);
  w.weapon = 0;
  stepWeaponTimers(w, 11, 0);
  assert.equal(w.slots[0]!.charge, 1);
  assert.equal(w.slots[0]!.reloading, false);
});
test("shots consume native drain per trigger, apply recoil and exhaust after three Bazooka shots", () => {
  const actor = worm(),
    w = world([actor]),
    a = arena();
  for (let i = 0; i < 3; i++) {
    actor.slots[0]!.lastFire = 0;
    assert.equal(fireWeapon(w, actor, a.ports), true);
  }
  assert.equal(actor.slots[0]!.charge, 0);
  assert.equal(actor.slots[0]!.reloading, true);
  assert.equal(actor.vx, -45);
  assert.equal(w.projectiles.length, 3);
  assert.equal(fireWeapon(w, actor, a.ports), false);
});
test("native shoot-list preparation consumes charge and captures state before deferred processing", () => {
  const actor = worm(),
    w = world([actor]),
    a = arena();
  actor.vx = 10;
  const shot = prepareWeaponShot(w, actor)!;
  assert.ok(shot);
  assert.equal(actor.vx, 10);
  assert.equal(w.projectiles.length, 0);
  actor.x = 900;
  actor.vx = 500;
  actor.weapon = 1;
  assert.equal(processWeaponShot(w, shot, a.ports), true);
  assert.equal(w.projectiles[0]!.x, 108);
  assert.equal(w.projectiles[0]!.vx, 150);
  assert.equal(actor.vx, 485);
  const dead = worm("dead"),
    other = world([dead]);
  const discarded = prepareWeaponShot(other, dead)!;
  dead.alive = false;
  assert.equal(processWeaponShot(other, discarded, a.ports), false);
  assert.ok(dead.slots[0]!.charge < 1);
  assert.equal(other.projectiles.length, 0);
});
test("native free-flight trajectories retain damping, gravity and float operation boundaries", () => {
  const names = ["Bazooka", "Grenade", "Rifle"],
    velocities = [
      [140, 0],
      [80, -110],
      [700, 0],
    ];
  for (let kind = 0; kind < names.length; kind++) {
    const w = world(),
      a = arena();
    const p = spawnClassicProjectile(
      w,
      descriptor(names[kind]!),
      "owner",
      id(names[kind]!),
      100,
      100,
      velocities[kind]![0]!,
      velocities[kind]![1]!,
      0,
    )!;
    for (let step = 1; step <= 100; step++) {
      advance(w, a.ports, 1);
      const expected = native.flight.find(
        (f) => f.kind === kind && f.step === step,
      );
      if (!expected) continue;
      assert.deepEqual(
        { x: p.x, y: p.y, vx: p.vx, vy: p.vy },
        { x: expected.x, y: expected.y, vx: expected.vx, vy: expected.vy },
        `${names[kind]} step${step}`,
      );
    }
  }
});
test("native high-speed terrain check can skip a one-pixel wall, while swept worm collision still hits", () => {
  const w = world(),
    a = arena({ solid: (x) => x === 104, dirt: false });
  const p = spawnClassicProjectile(
    w,
    descriptor("Rifle"),
    "owner",
    id("Rifle"),
    100,
    100,
    700,
    0,
    0,
  )!;
  advance(w, a.ports, 1);
  assert.ok(p.x > 104);
  assert.equal(a.holes.length, 0);
  const target = worm("target", 104, 100),
    hitWorld = world([target]),
    hits = arena();
  spawnClassicProjectile(
    hitWorld,
    descriptor("Rifle"),
    "owner",
    id("Rifle"),
    100,
    100,
    700,
    0,
    0,
  );
  advance(hitWorld, hits.ports, 1);
  assert.deepEqual(
    hits.injuries.map((x) => [x.id, x.damage]),
    [["target", 34]],
  );
  assert.equal(hitWorld.projectiles.length, 0);
});
test("native Spawn calculates thresholds before wallshoot, including quantized adaptive Rifle substeps", () => {
  for (const reference of native.rifleSpawns) {
    const w = world(),
      a = arena();
    const p = spawnClassicProjectile(
      w,
      descriptor("Rifle"),
      "owner",
      id("Rifle"),
      100,
      100,
      700,
      0,
      reference.seed,
    )!;
    assert.deepEqual(
      {
        maxCheck: p.maxCheck,
        avgCheck: p.avgCheck,
        randomIndex: p.randomIndex,
        wallShootTime: p.wallShootTime,
      },
      {
        maxCheck: reference.maxCheck,
        avgCheck: reference.avgCheck,
        randomIndex: reference.randomIndex,
        wallShootTime: reference.wallShootTime,
      },
    );
    for (let step = 1; step <= 10; step++) {
      advance(w, a.ports, 1);
      const expected = reference.flight.find((v) => v.step === step);
      if (expected)
        assert.deepEqual(
          { x: p.x, y: p.y, vx: p.vx, vy: p.vy },
          { x: expected.x, y: expected.y, vx: expected.vx, vy: expected.vy },
        );
    }
  }
});
test("native wrong corner bounce gives right-wall priority over bottom reflection", () => {
  const w = world(),
    a = arena({ width: 128, height: 128 });
  const p = spawnClassicProjectile(
    w,
    descriptor("Grenade"),
    "owner",
    id("Grenade"),
    125,
    125,
    100,
    Math.fround(150 - Math.fround(130 * Math.fround(11 * 0.001))),
    0,
  )!;
  advance(w, a.ports, 1);
  assert.deepEqual({ vx: p.vx, vy: p.vy }, native.cornerBounce);
});
test("Bazooka child spread and random-index propagation match original C++ spawning", () => {
  const w = world(),
    a = arena({ solid: () => true, dirt: true });
  spawnClassicProjectile(
    w,
    descriptor("Bazooka"),
    "owner",
    id("Bazooka"),
    1000,
    1000,
    140,
    0,
    0,
  );
  advance(w, a.ports, 1);
  assert.equal(w.projectiles.length, 12);
  assert.deepEqual(
    w.projectiles.slice(0, 4).map(({ vx, vy, timeVarRandom, randomIndex }) => ({
      vx,
      vy,
      timeVarRandom,
      randomIndex,
    })),
    native.bazookaChildren,
  );
});
test("grenade timer uses the native fixed random variation and spawns fifty real fragments", () => {
  const w = world(),
    a = arena();
  const p = spawnClassicProjectile(
    w,
    descriptor("Grenade"),
    "owner",
    id("Grenade"),
    1000,
    1000,
    0,
    0,
    0,
  )!;
  advance(w, a.ports, native.grenadeTimerPreSteps);
  assert.equal(p.used, true);
  assert.equal(p.life, native.grenadeTimerLife);
  advance(w, a.ports, 1);
  assert.equal(p.used, false);
  assert.equal(w.projectiles.length, 50);
  assert.equal(a.holes.at(-1)!.size, 5);
  assert.ok(
    w.projectiles.every(
      (c) => c.owner === "owner" && c.descriptorId !== p.descriptorId,
    ),
  );
});
test("timed explosions preserve the source player-hit damage override and 5px full damage", () => {
  const close = worm("close", 1004, 1000),
    far = worm("far", 1006, 1000),
    w = world([close, far]),
    a = arena();
  const p = spawnClassicProjectile(
    w,
    descriptor("Booby Trap"),
    "owner",
    id("Booby Trap"),
    1000,
    1000,
    0,
    0,
    0,
  )!;
  p.life = 56;
  advance(w, a.ports, 1);
  assert.equal(a.holes[0]!.size, 28);
  assert.deepEqual(
    a.injuries.map((v) => [v.id, v.damage]),
    [["close", 28]],
  );
  assert.equal(p.used, false);
});
test("explosion and swept-hit tests use the exact native ring slot rather than current position", () => {
  const target = worm("target", 199, 1000);
  target.positionRecordings = createPositionRecorder();
  for (let x = 100; x < 200; x++)
    recordPosition(target.positionRecordings, { x, y: 1000 });
  const w = world([target]),
    a = arena();
  const p = spawnClassicProjectile(
    w,
    descriptor("Booby Trap"),
    "owner",
    id("Booby Trap"),
    100,
    1000,
    0,
    0,
    0,
  )!;
  p.life = 56;
  advance(w, a.ports, 1);
  assert.deepEqual(
    a.injuries.map((i) => [i.id, i.damage]),
    [["target", 28]],
  );
});
test("Dirt Ball lays the three native offsets and Greenball uses the green-dirt operation", () => {
  const w = world(),
    a = arena();
  const p = spawnClassicProjectile(
    w,
    descriptor("Dirt Ball"),
    "owner",
    id("Dirt Ball"),
    1000,
    1000,
    0,
    0,
    0,
  )!;
  p.life = 2;
  advance(w, a.ports, 1);
  assert.equal(a.placements.length, 3);
  const x = p.x,
    y = p.y;
  assert.deepEqual(a.placements, [
    { x: Math.fround(x - 6), y: Math.fround(y - 6), green: false },
    { x: Math.fround(x + 6), y: Math.fround(y - 6), green: false },
    { x, y: Math.fround(y + 6), green: false },
  ]);
  const green = world(),
    ground = arena({ solid: () => true, dirt: true });
  spawnClassicProjectile(
    green,
    descriptor("Greenball"),
    "owner",
    id("Greenball"),
    1000,
    1000,
    0,
    0,
    0,
  );
  advance(green, ground.ports, 2);
  assert.equal(ground.placements.length, 1);
  assert.equal(ground.placements[0]!.green, true);
});
test("laser is an instantaneous width-one beam stopped by terrain, not a moving projectile", () => {
  const target = worm("target", 150, 100),
    actor = worm(),
    w = world([actor, target]),
    a = arena({ solid: (x) => x === 200 });
  actor.weapon = 3;
  assert.equal(fireWeapon(w, actor, a.ports), true);
  assert.deepEqual(
    a.injuries.map((v) => [v.id, v.damage]),
    [["target", 1]],
  );
  assert.equal(w.projectiles.length, 0);
  assert.equal(w.effects.at(-1)!.kind, "beam");
  assert.ok(w.effects.at(-1)!.endX! < 150);
  const blocked = arena({ solid: (x) => x === 125 });
  actor.slots[3]!.lastFire = 0;
  fireWeapon(w, actor, blocked.ports);
  assert.equal(blocked.injuries.length, 0);
  assert.equal(blocked.holes[0]!.size, 0);
});
test("held Laser follows the native local/listen shared-slot sequence over200 outer frames", () => {
  const player = worm(),
    w = world([player]),
    a = arena();
  player.weapon = 3;
  let physicsMs = 0,
    pending: PreparedShot[] = [];
  for (const expected of native.localLaserFrames) {
    w.elapsedMs = expected.frame * 10;
    for (const shot of pending) processWeaponShot(w, shot, a.ports);
    pending = [];
    let didShoot = false;
    while (physicsMs + 11 <= w.elapsedMs) {
      stepWeaponTimers(player);
      const shot = prepareWeaponShot(w, player);
      if (shot) {
        pending.push(shot);
        didShoot = true;
      }
      stepClientWeapon(player, 10);
      physicsMs += 11;
    }
    const slot = player.slots[player.weapon]!;
    assert.deepEqual(
      {
        frame: expected.frame,
        physicsMs,
        shot: didShoot,
        pending: pending.length,
        lastFire: slot.lastFire,
        charge: slot.charge,
      },
      expected,
    );
  }
});
test("bonus explosions precede the outer blast and beam bonus hits use the same zero-damage chain trigger", () => {
  const actor = worm("actor", 1000, 1000),
    w = world([actor]),
    a = arena();
  let bonus = true;
  a.ports.explodeBonuses = () => {
    if (!bonus) return 0;
    bonus = false;
    return 2;
  };
  const p = spawnClassicProjectile(
    w,
    descriptor("Booby Trap"),
    "owner",
    id("Booby Trap"),
    1000,
    1000,
    0,
    0,
    0,
  )!;
  p.life = 56;
  advance(w, a.ports, 1);
  assert.deepEqual(
    a.injuries.map((i) => i.damage),
    [15, 15, 28],
  );
  const beamWorld = world([actor]),
    beamArena = arena();
  actor.weapon = 3;
  actor.slots[3]!.lastFire = 0;
  let found = true;
  beamArena.ports.beamBonusAt = (x) => x > 1010;
  beamArena.ports.explodeBonuses = () => {
    if (!found) return 0;
    found = false;
    return 1;
  };
  assert.equal(fireWeapon(beamWorld, actor, beamArena.ports), true);
  assert.deepEqual(
    beamArena.holes.map((h) => h.size),
    [15, 0],
  );
});
test("every packaged Classic weapon and child chain executes without unknown action fallbacks", () => {
  const a = arena({ width: 16384, height: 16384 });
  for (const weapon of CLASSIC_WEAPONS) {
    const actor = worm();
    actor.x = actor.y = 8000;
    actor.slots = createWeaponSlots(Array(5).fill(weapon.id) as number[]);
    const w = world([actor]);
    assert.equal(fireWeapon(w, actor, a.ports), true, weapon.name);
    advance(w, a.ports, 500);
    assert.ok(w.projectiles.length <= 3000);
    assert.ok(
      w.projectiles.every(
        (p) =>
          Number.isFinite(p.x) &&
          Number.isFinite(p.y) &&
          CLASSIC_PROJECTILES[p.descriptorId],
      ),
      weapon.name,
    );
  }
});
test("native pool capacity is3000 and freed slots are reused deterministically", () => {
  const w = world();
  for (let i = 0; i < 3000; i++)
    assert.ok(
      spawnClassicProjectile(
        w,
        descriptor("Bazooka"),
        "owner",
        0,
        100,
        100,
        0,
        0,
        0,
      ),
    );
  assert.equal(
    spawnClassicProjectile(
      w,
      descriptor("Bazooka"),
      "owner",
      0,
      100,
      100,
      0,
      0,
      0,
    ),
    undefined,
  );
  w.projectiles[17]!.used = false;
  assert.equal(
    spawnClassicProjectile(
      w,
      descriptor("Bazooka"),
      "owner",
      0,
      100,
      100,
      0,
      0,
      0,
    )!.slot,
    17,
  );
});
test("native weapon sample names attach to one existing stable muzzle effect only when UseSound is set", () => {
  const actor = worm(),
    w = world([actor]),
    a = arena();
  assert.equal(fireWeapon(w, actor, a.ports), true);
  const muzzle = w.effects.find((effect) => effect.kind === "muzzle")!;
  assert.equal(w.effects.length, 1);
  assert.equal(muzzle.sound, "Bazooka.wav");
  assert.equal(muzzle.id, 1);
  assert.equal(w.projectiles[0]!.id, 2);
  assert.equal(w.nextId, 3);
  advance(w, a.ports, 3);
  assert.deepEqual(
    w.effects
      .filter((effect) => effect.sound)
      .map((effect) => ({ id: effect.id, sound: effect.sound })),
    [{ id: 1, sound: "Bazooka.wav" }],
  );
  const silent = worm("silent");
  silent.slots = createWeaponSlots(Array(5).fill(id("Flamer")) as number[]);
  const quiet = world([silent]);
  assert.equal(fireWeapon(quiet, silent, a.ports), true);
  assert.equal(quiet.effects.length, 1);
  assert.equal(quiet.effects[0]!.kind, "muzzle");
  assert.equal(quiet.effects[0]!.sound, undefined);
});
test("native hit sound attaches to its actual explosion and timer UseSound absence stays silent", () => {
  const w = world(),
    a = arena({ solid: () => true, dirt: true });
  spawnClassicProjectile(
    w,
    descriptor("Bazooka"),
    "owner",
    id("Bazooka"),
    1000,
    1000,
    140,
    0,
    0,
  );
  advance(w, a.ports, 1);
  assert.deepEqual(
    w.effects
      .filter((effect) => effect.sound)
      .map((effect) => ({ kind: effect.kind, sound: effect.sound })),
    [{ kind: "explosion", sound: "Exp2.wav" }],
  );
  const effect = w.effects.find((effect) => effect.sound)!;
  assert.equal(effect.id, 2);
  assert.equal(w.projectiles.length, 12);
  const timed = world(),
    open = arena();
  const grenade = spawnClassicProjectile(
    timed,
    descriptor("Grenade"),
    "owner",
    id("Grenade"),
    1000,
    1000,
    0,
    0,
    0,
  )!;
  grenade.life = 3;
  advance(timed, open.ports, 1);
  assert.equal(grenade.used, false);
  assert.ok(timed.effects.some((effect) => effect.kind === "explosion"));
  assert.equal(
    timed.effects.some((effect) => effect.sound !== undefined),
    false,
  );
});
test("all sound-bearing packaged Classic actions have an existing physical explosion effect", () => {
  let samples = 0;
  for (const descriptor of CLASSIC_PROJECTILES)
    for (const action of [
      descriptor.hit,
      descriptor.timer,
      descriptor.playerHit,
    ])
      if (action?.useSound === 1) {
        samples++;
        assert.equal(action.name, "explode");
        assert.ok(
          "damage" in action &&
            action.damage !== undefined &&
            action.damage >= 0,
        );
        assert.ok(action.sound);
      }
  assert.equal(samples, 19);
});
