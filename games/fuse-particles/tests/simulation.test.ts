import assert from "node:assert/strict";
import test from "node:test";
import {
  actBattle,
  BATTLE_TIMEOUT_TICKS,
  canActBattle,
  createBattle,
  decodeBattle,
  eligibleSite,
  isBattleAction,
  MAPS,
  tickBattle,
  type BattleState,
} from "../src/game/simulation.js";

function run(s: BattleState, n: number) {
  for (let i = 0; i < n; i++) tickBattle(s);
}

test("all seven seeded maps connect the two sides, triangle and four corners", () => {
  const signatures = new Set<string>();
  for (const map of MAPS)
    for (const seats of [2, 3, 4]) {
      const s = createBattle(217, map, Array<boolean>(seats).fill(false));
      signatures.add(JSON.stringify(s.walls));
      const first = s.cores[0]!,
        idx = (x: number, y: number) => Math.floor(y) * s.cols + Math.floor(x);
      const seen = new Set([idx(first.x, first.y)]),
        queue = [...seen];
      for (let i = 0; i < queue.length; i++) {
        const cell = queue[i]!,
          x = cell % s.cols,
          y = Math.floor(cell / s.cols);
        for (const [dx, dy] of [
          [0, -1],
          [1, 0],
          [0, 1],
          [-1, 0],
        ]) {
          const a = x + dx!,
            b = y + dy!,
            n = idx(a, b);
          if (
            a >= 0 &&
            a < s.cols &&
            b >= 0 &&
            b < s.rows &&
            !s.walls[n] &&
            !seen.has(n)
          ) {
            seen.add(n);
            queue.push(n);
          }
        }
      }
      assert.ok(s.cores.every((c) => seen.has(idx(c.x, c.y))));
      assert.ok(decodeBattle(s));
      if (seats === 2) assert.equal(s.cores[0]!.y, s.cores[1]!.y);
      else assert.equal(new Set(s.cores.map((c) => c.y)).size, 2);
    }
  assert.equal(signatures.size, 21);
});

test("four human and AI seats replay identically after restoring a mid-flight battle", () => {
  const s = createBattle(913, "random", [false, true, false, true]);
  assert.ok(actBattle(s, 0, { type: "upgrade", upgrade: "attack" }));
  assert.equal(s.cores[0]!.gold, 20);
  assert.equal(actBattle(s, 0, { type: "upgrade", upgrade: "attack" }), false);
  run(s, 400);
  assert.ok(s.particles.some((p) => p.vx !== 0 && p.vy !== 0));
  assert.ok(s.ownership.includes(0));
  assert.equal(s.cores[0]!.upgrades.attack, 1);
  assert.ok(Object.values(s.cores[1]!.upgrades).some((v) => v > 0));
  const restored = decodeBattle(JSON.parse(JSON.stringify(s)));
  assert.ok(restored);
  for (const b of [s, restored]) {
    actBattle(b, 2, { type: "upgrade", upgrade: "health" });
    run(b, 150);
  }
  assert.deepEqual(restored, s);
  assert.ok(
    s.samples.at(-1)!.players.every((p) => p.army > 0 && p.territory > 0),
  );
});

test("ownership, timed research, site reservation, tower upgrades and cooldowns", () => {
  const s = createBattle(8, "lanes", [false, false, false]),
    c = s.cores[0]!;
  c.gold = 3000;
  assert.equal(
    actBattle(s, 0, { type: "build", tower: "laser", site: 0 }),
    false,
  );
  assert.ok(actBattle(s, 0, { type: "research", tower: "laser" }));
  run(s, 399);
  assert.equal(c.research.laser, false);
  tickBattle(s);
  assert.equal(c.research.laser, true);
  const p = s.sites[0]!;
  for (const [dx, dy] of [
    [-1, 0],
    [1, 0],
    [0, -1],
    [0, 1],
  ])
    s.ownership[Math.floor(p.y + dy!) * s.cols + Math.floor(p.x + dx!)] = 0;
  assert.ok(eligibleSite(s, 0, 0));
  assert.ok(actBattle(s, 0, { type: "build", tower: "laser", site: 0 }));
  assert.equal(eligibleSite(s, 0, 0), false);
  run(s, 60);
  assert.equal(s.towers[0]?.kind, "laser");
  assert.ok(actBattle(s, 0, { type: "tower", site: 0 }));
  run(s, 100);
  assert.equal(s.towers[0]!.level, 1);
  assert.ok(actBattle(s, 0, { type: "nuke" }));
  assert.equal(canActBattle(s, 0, { type: "nuke" }), false);
  // Move to research completion with live participants, then exercise actual ability activation.
  s.tick = c.jobs[0]!.ready - 1;
  tickBattle(s);
  assert.ok(c.research.nuke);
  assert.ok(s.particles.some((p) => p.owner !== 0));
  assert.ok(actBattle(s, 0, { type: "nuke" }));
  assert.ok(s.particles.every((p) => p.owner === 0));
  assert.equal(actBattle(s, 0, { type: "nuke" }), false);
});

test("wall ricochets, free drift and opponent core scoring", () => {
  const s = createBattle(29, "lanes", [false, false]);
  run(s, 4);
  const p = s.particles.find((p) => p.owner === 0)!;
  s.particles = [p];
  s.walls.fill(false);
  Object.assign(p, { x: 10.9, y: 6.5, vx: p.speed, vy: 0 });
  s.walls[6 * s.cols + 11] = true;
  tickBattle(s);
  assert.ok(p.vx < 0 && p.vy !== 0);
  assert.equal(p.x, 10.9);
  Object.assign(p, { x: 60.1, y: 16, vx: p.speed, vy: 0 });
  const before = s.cores[1]!.hp;
  tickBattle(s);
  assert.equal(s.cores[1]!.hp, before - 1);
  assert.ok(!s.particles.includes(p));
});

test("mutual collision credits both attackers and records combat", () => {
  const s = createBattle(5, "rooms", [false, false]);
  run(s, 4);
  s.walls.fill(false);
  for (const p of s.particles) {
    p.x = 30 + p.owner * 0.5;
    p.y = 10;
    p.hp = 1;
    p.vx = (p.owner ? -1 : 1) * p.speed;
    p.vy = 0;
  }
  tickBattle(s);
  assert.deepEqual(
    s.cores.map((c) => c.kills),
    [1, 1],
  );
  assert.deepEqual(
    s.cores.map((c) => c.produced),
    [1, 1],
  );
});

test("a subpixel position that rounds onto a wall ricochets without claiming the wall", () => {
  const s = createBattle(29, "lanes", [false, false]);
  run(s, 4);
  const p = s.particles.find((p) => p.owner === 0)!;
  s.particles = [p];
  const tile = 6 * s.cols + 11;
  s.walls[tile] = true;
  s.walls[tile - 1] = false;
  Object.assign(p, { x: 10.1, y: 6.5, vx: p.speed, vy: 0 });
  const open = structuredClone(s);
  tickBattle(open);
  const dx = open.particles[0]!.vx / 20;
  p.x = 11 - dx - 0.0000002;
  tickBattle(s);
  assert.ok(p.vx < 0);
  assert.equal(s.ownership[tile], -1);
  assert.ok(decodeBattle(s));
});

test("last surviving core, timeout ties and frozen results", () => {
  const s = createBattle(6, "fortress", [false, false, true]);
  s.cores[0]!.hp = 0;
  s.cores[1]!.hp = 0;
  tickBattle(s);
  assert.equal(s.winner, 2);
  const last = s.tick;
  tickBattle(s);
  assert.equal(s.tick, last);
  const tie = createBattle(30, "islands", [false, false]);
  tie.tick = BATTLE_TIMEOUT_TICKS - 1;
  tickBattle(tie);
  assert.equal(tie.winner, -1);
  assert.ok(decodeBattle(tie));
});

test("reject malformed actions and checkpoints before replacing state", () => {
  assert.equal(
    isBattleAction({ type: "build", tower: "bogus", site: 0 }),
    false,
  );
  assert.equal(isBattleAction({ type: "tower", site: -1 }), false);
  assert.equal(isBattleAction({ type: "nuke", owner: 1 }), false);
  const s = createBattle(4, "maze", [false, true]);
  run(s, 6);
  assert.equal(decodeBattle({ ...s, ownership: [3] }), undefined);
  assert.equal(
    decodeBattle({ ...s, particles: [{ ...s.particles[0], owner: 3 }] }),
    undefined,
  );
  assert.equal(decodeBattle({ ...s, nextId: 0 }), undefined);
  assert.ok(decodeBattle(s));
});
