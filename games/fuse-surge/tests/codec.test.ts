import test from "node:test";
import assert from "node:assert/strict";
import {
  botInput,
  cloneWorld,
  decodeWorld,
  encodeWorld,
  planInput,
  riderId,
  stepWorld,
  type BotLevel,
  type Rules,
  type World,
} from "../src/engine/index.js";
import * as T from "../src/engine/tuning.js";
import { fresh, steps, ticks } from "./fixtures/world.js";

const bots = (world: World, slot: number) =>
  botInput(world, slot, (slot % 3) as BotLevel);

const PLAIN = { double: false, tall: false, boss: false, glide: false };
/** A match of four bots at some point of its play, by the plain rules unless `rules` says otherwise. */
function midMatch(
  tickCount: number,
  seed = 77,
  rules: Partial<Rules> = PLAIN,
): World {
  const world = fresh({ target: 2, seconds: 20, ...rules }, seed, [
    "a",
    "b",
    "c",
    "d",
  ]);
  ticks(world, tickCount, bots);
  return world;
}

test("a world round-trips through its checkpoint fields at every phase, and the copy plays on identically", () => {
  const world = fresh({ target: 2, seconds: 20, hits: 2, glide: true }, 31, [
    "a",
    "b",
    "c",
    "d",
  ]);
  const phases = new Set<string>(),
    seen = { bolt: false, tall: false, airJump: false, tallNext: false };
  for (let tick = 0; tick < 4000 && world.phase !== "over"; tick++) {
    const bits = world.riders.map((_, slot) => bots(world, slot));
    for (let i = 0; i < T.STEPS_PER_TICK; i++) {
      stepWorld(world, bits);
      if (world.step % 7 !== 0) continue;
      phases.add(world.phase);
      seen.bolt ||= world.surges.some((surge) => surge.lane >= 0);
      seen.tall ||= world.surges.some((surge) => surge.kind === 2);
      seen.airJump ||= world.riders.some((rider) => rider.jumps === 1);
      seen.tallNext ||= world.tallNext;
      const fields = encodeWorld(world);
      const decoded = decodeWorld(JSON.parse(JSON.stringify(fields)));
      assert.deepEqual(decoded, world, `step ${world.step} (${world.phase})`);
    }
  }
  assert.deepEqual([...phases].sort(), ["break", "play", "ready"]);
  assert.deepEqual(
    seen,
    { bolt: true, tall: true, airJump: true, tallNext: true },
    "the match showed every new thing a checkpoint can hold",
  );
  assert.equal(world.phase, "over");
  const done = decodeWorld(encodeWorld(world));
  assert.deepEqual(done, world, "a finished match decodes");
  // A decoded copy plays on exactly as the original does.
  const original = midMatch(300),
    copy = decodeWorld(encodeWorld(original))!;
  ticks(original, 200, bots);
  ticks(copy, 200, bots);
  assert.deepEqual(copy, original);
});

/** The fields with one of them replaced; `rider`/`surge` index into those tuples. */
function tampered(
  world: World,
  change: (fields: unknown[]) => void,
): World | undefined {
  const fields = JSON.parse(JSON.stringify(encodeWorld(world))) as unknown[];
  change(fields);
  return decodeWorld(fields);
}
const RIDER = 19,
  SURGES = 18;

test("every out-of-range or malformed field is refused, and the world given is left alone", () => {
  const world = midMatch(260);
  assert.equal(world.phase, "play");
  assert.ok(world.surges.length > 0);
  const before = JSON.stringify(world);
  assert.ok(decodeWorld(encodeWorld(world)));
  for (const raw of [null, undefined, 7, "world", {}, [], [1, 2, 3]])
    assert.equal(decodeWorld(raw), undefined);
  const head: [number, unknown][] = [
    [0, 1],
    [0, 3],
    [1, 0],
    [1, 2 ** 32],
    [2, -1],
    [2, 1.5],
    [3, 4],
    [3, "play"],
    [4, 1],
    [5, 0],
    [5, T.MAX_ROUNDS + 1],
    [6, -1],
    [6, 20 * T.STEPS_PER_SECOND + 1],
    [7, [3, 20, 1, 2, 1]],
    [7, [0, 20, 1, 2, 1, 0, 0, 0, 0]],
    [7, [3, 5, 1, 2, 1, 0, 0, 0, 0]],
    [7, [3, T.MAX_SECONDS + 1, 1, 2, 1, 0, 0, 0, 0]],
    [7, [3, 20, 3, 2, 1, 0, 0, 0, 0]],
    [7, [3, 20, 1, 6, 1, 0, 0, 0, 0]],
    [7, [3, 20, 1, 2, 2, 0, 0, 0, 0]],
    [7, [3, 20, 1, 2, 1, 2, 0, 0, 0]],
    [7, [3, 20, 1, 2, 1, 0, true, 0, 0]],
    [7, [3, 20, 1, 2, 1, 0, 0, 2, 0]],
    [7, [3, 20, 1, 2, 1, 0, 0, 0, -1]],
    [7, "rules"],
    [8, 0],
    [9, 257],
    [10, 0],
    [11, 2],
    [12, T.MAX_RUN + 1],
    [13, 2],
    // A tall surge is never on its way where the rules send none.
    [13, 1],
    [14, 16],
    [15, 4],
    [16, 16],
    [17, T.COUNTER],
    [17, -0],
    [SURGES, "none"],
    [
      SURGES,
      Array.from({ length: T.MAX_SURGES + 1 }, () => [1, 0, 0, -1, 5, 0, 0]),
    ],
  ];
  for (const [index, value] of head)
    assert.equal(
      tampered(world, (fields) => (fields[index] = value)),
      undefined,
      `head field ${index} = ${JSON.stringify(value)}`,
    );
  const rider: [number, unknown][] = [
    [0, ""],
    [0, "x".repeat(65)],
    [0, 5],
    [1, T.START_X + 1],
    [1, T.OUT_X - 1],
    [2, T.MAX_Y + 1],
    [2, -T.FALL_DEPTH - 1],
    [3, T.JUMP_V + 1],
    [3, -T.MAX_FALL_V - 1],
    [4, 2],
    [5, true],
    [6, T.JUMP_BUFFER + 1],
    [7, 2],
    // An air jump is never spent where the rules give none.
    [7, 1],
    [8, 4],
    [9, 2],
    [10, T.REEL_STEPS + 1],
    [11, T.GRACE_STEPS + 1],
    [12, T.STREAK_FOR_STEP + 1],
    [13, 3],
    [14, T.MOST_DODGES + 1],
    [15, T.MOST_TAKEN + 1],
  ];
  for (const [index, value] of rider)
    assert.equal(
      tampered(
        world,
        (fields) => ((fields[RIDER] as unknown[])[index] = value),
      ),
      undefined,
      `rider field ${index} = ${JSON.stringify(value)}`,
    );
  const surge: [number, unknown][] = [
    [0, 0],
    [1, 3],
    // A tall surge and a bolt come only where the rules send them.
    [1, 2],
    [2, 2],
    [3, 4],
    [3, -2],
    [3, 0],
    [4, T.EXIT_X],
    [4, T.SPAWN_X + 1],
    [5, 16],
    [6, 16],
  ];
  for (const [index, value] of surge)
    assert.equal(
      tampered(
        world,
        (fields) =>
          (((fields[SURGES] as unknown[])[0] as unknown[])[index] = value),
      ),
      undefined,
      `surge field ${index} = ${JSON.stringify(value)}`,
    );
  // Tuples of the wrong length, a rider too few and a rider too many.
  assert.equal(
    tampered(world, (f) => (f[RIDER] as unknown[]).push(0)),
    undefined,
  );
  assert.equal(
    tampered(world, (f) => ((f[SURGES] as unknown[])[0] as unknown[]).pop()),
    undefined,
  );
  assert.equal(
    tampered(world, (f) => f.splice(RIDER + 1)),
    undefined,
  );
  assert.equal(
    tampered(world, (f) => f.push(f[RIDER], f[RIDER])),
    undefined,
  );
  assert.equal(
    JSON.stringify(world),
    before,
    "nothing above touched the world",
  );
  assert.ok(riderId("a") && !riderId("") && !riderId(3));
});

test("cross-field checks: what the simulation never produces is not a world", () => {
  const playing = midMatch(260);
  const rider = (change: (rider: unknown[]) => void) =>
    tampered(playing, (fields) => change(fields[RIDER] as unknown[]));
  // Two riders with one id.
  assert.equal(
    tampered(playing, (f) => ((f[RIDER + 1] as unknown[])[0] = "a")),
    undefined,
  );
  // Out without the hits, and the hits without being out.
  assert.equal(
    rider((r) => (r[9] = 1)),
    undefined,
  );
  assert.equal(
    rider((r) => (r[8] = 3)),
    undefined,
  );
  // On the deck: never past the last foothold, never under the surface, never ducking in the air.
  assert.equal(
    rider((r) => (r[1] = T.LAST_X - 1)),
    undefined,
  );
  assert.equal(
    rider((r) => (r[2] = -1)),
    undefined,
  );
  assert.equal(
    rider((r) => ((r[4] = 1), (r[2] = 500))),
    undefined,
  );
  assert.equal(
    rider((r) => ((r[4] = 1), (r[2] = 0), (r[3] = 50))),
    undefined,
  );
  // Reeling and its afterglow are one after the other.
  assert.equal(
    rider((r) => ((r[10] = 5), (r[11] = 5))),
    undefined,
  );
  // A rider that is out is done ducking and reeling, and is under the deck only past its edge.
  const gone = (change: (rider: unknown[]) => void) =>
    rider((r) => {
      r[8] = 3;
      r[9] = 1;
      r[4] = 0;
      r[10] = 0;
      r[11] = 0;
      change(r);
    });
  assert.ok(
    gone(() => {}),
    "a rider knocked out mid-round is a world",
  );
  assert.equal(
    gone((r) => (r[10] = 3)),
    undefined,
  );
  assert.equal(
    gone((r) => (r[11] = 3)),
    undefined,
  );
  assert.equal(
    gone((r) => ((r[2] = 0), (r[3] = 0), (r[4] = 1))),
    undefined,
  );
  assert.equal(
    gone((r) => ((r[1] = T.EDGE_X + 5), (r[2] = -10))),
    undefined,
  );
  assert.ok(gone((r) => ((r[1] = T.OUT_X), (r[2] = -10))));
  // Surges: struck only who it is settled for, flips only before the gate, in the order they were sent, ids once.
  const surge = (change: (surges: unknown[][]) => void) =>
    tampered(playing, (fields) => change(fields[SURGES] as unknown[][]));
  assert.equal(
    surge((s) => ((s[0]![5] = 0), (s[0]![6] = 1))),
    undefined,
  );
  assert.equal(
    surge((s) => ((s[0]![2] = 1), (s[0]![4] = T.GATE_X))),
    undefined,
  );
  assert.equal(
    surge((s) => s.push([999, 0, 0, -1, s[0]![4], 0, 0])),
    undefined,
  );
  assert.equal(
    surge((s) => s.push([s[0]![0], 0, 0, -1, T.SPAWN_X, 0, 0])),
    undefined,
  );
  // The phases: a countdown has played nothing, a round has two riders up and time left, and only breaks rest.
  const ready = fresh({}, 5);
  steps(ready, 10);
  assert.ok(decodeWorld(encodeWorld(ready)));
  assert.equal(
    tampered(ready, (f) => (f[6] = 5)),
    undefined,
  );
  assert.equal(
    tampered(ready, (f) => (f[4] = 0)),
    undefined,
  );
  assert.equal(
    tampered(ready, (f) => (f[4] = T.READY_STEPS + 1)),
    undefined,
  );
  assert.equal(
    tampered(ready, (f) => (f[SURGES] = [[1, 0, 0, -1, 5000, 0, 0]])),
    undefined,
  );
  assert.equal(
    tampered(ready, (f) => {
      const r = f[RIDER] as unknown[];
      r[8] = 3;
      r[9] = 1;
    }),
    undefined,
    "nobody is out during a countdown",
  );
  assert.equal(
    tampered(playing, (f) => (f[6] = 20 * T.STEPS_PER_SECOND)),
    undefined,
  );
  assert.equal(
    tampered(playing, (f) => {
      for (const index of [RIDER, RIDER + 1, RIDER + 2]) {
        const r = f[index] as unknown[];
        Object.assign(r, { 4: 0, 8: 3, 9: 1, 10: 0, 11: 0 });
      }
    }),
    undefined,
    "a round with one rider up has ended",
  );
  // Wins, winners and reasons agree with the phase.
  assert.equal(
    tampered(playing, (f) => ((f[RIDER] as unknown[])[13] = 2)),
    undefined,
  );
  assert.equal(
    tampered(playing, (f) => (f[16] = 1)),
    undefined,
  );
  assert.equal(
    tampered(ready, (f) => (f[15] = 1)),
    undefined,
  );
  assert.equal(
    tampered(ready, (f) => (f[14] = 1)),
    undefined,
  );
  assert.equal(
    tampered(ready, (f) => (f[5] = 2)),
    undefined,
  );
  const over = cloneWorld(midMatch(6000));
  assert.equal(over.phase, "over");
  assert.ok(decodeWorld(encodeWorld(over)));
  assert.equal(
    tampered(over, (f) => (f[16] = 0)),
    undefined,
  );
  assert.equal(
    tampered(over, (f) => (f[16] = 15)),
    undefined,
  );
  assert.equal(
    tampered(over, (f) => {
      for (const index of [RIDER, RIDER + 1, RIDER + 2, RIDER + 3])
        (f[index] as unknown[])[13] = 1;
      f[16] = 15;
    }),
    undefined,
    "nobody reached the target",
  );
});

test("the switchable rules' own state is checked against the rules that allow it", () => {
  // A match with everything on, caught with bolts on the deck.
  const world = fresh({ seconds: 20, hits: 9, glide: true }, 9, [
    "a",
    "b",
    "c",
  ]);
  let bolts: number[] = [];
  for (let tick = 0; tick < 2000 && bolts.length < 2; tick++) {
    ticks(world, 1, (w, slot) => planInput(w, slot));
    bolts = world.surges.flatMap((surge, index) =>
      surge.lane >= 0 ? [index] : [],
    );
    // Two bolts of one volley, side by side.
    if (
      bolts.length >= 2 &&
      world.surges[bolts[0]!]!.x !== world.surges[bolts[1]!]!.x
    )
      bolts = [];
  }
  assert.equal(world.phase, "play");
  assert.ok(bolts.length >= 2, "a volley of at least two bolts is on the deck");
  assert.deepEqual(decodeWorld(encodeWorld(world)), world);
  const [first, second] = bolts as [number, number];
  const surges = (change: (surges: unknown[][]) => void) =>
    tampered(world, (fields) => change(fields[SURGES] as unknown[][]));
  // A bolt is settled only with its own lane's rider, never flips and is never tall.
  const lane = world.surges[first]!.lane;
  assert.equal(
    surges((s) => (s[first]![5] = 1 << ((lane + 1) % 3))),
    undefined,
  );
  assert.equal(
    surges((s) => (s[first]![2] = 1)),
    undefined,
  );
  assert.equal(
    surges((s) => (s[first]![1] = 2)),
    undefined,
  );
  // A volley's bolts run abreast in lane order; a surge across the deck never shares a place with anything.
  assert.equal(
    surges((s) => {
      const held = s[first]!;
      s[first] = s[second]!;
      s[second] = held;
    }),
    undefined,
  );
  assert.equal(
    surges((s) => (s[second]![3] = s[first]![3])),
    undefined,
  );
  assert.equal(
    surges((s) => (s[second]![3] = -1)),
    undefined,
  );
  // Without the Warden there are no bolts; without the double jump, no tall surge, none on its way, no air jump.
  assert.equal(
    tampered(world, (f) => ((f[7] as unknown[])[7] = 0)),
    undefined,
  );
  const quiet = midMatch(260, 77, { ...PLAIN, double: true, tall: true });
  assert.ok(decodeWorld(encodeWorld(quiet)));
  assert.ok(
    tampered(quiet, (f) => (f[13] = 1)),
    "a tall surge can be on its way",
  );
  assert.equal(
    tampered(quiet, (f) => ((f[13] = 1), ((f[7] as unknown[])[5] = 0))),
    undefined,
  );
  // An air jump is spent only in the air.
  const grounded = quiet.riders.findIndex(
    (rider) => !rider.out && rider.y === 0 && rider.vy === 0,
  );
  assert.ok(grounded >= 0);
  assert.equal(
    tampered(quiet, (f) => ((f[RIDER + grounded] as unknown[])[7] = 1)),
    undefined,
  );
  // An endless round's clock runs to its own far bound, and no further.
  const endless = fresh({ seconds: 0, ...PLAIN }, 3);
  steps(endless, T.READY_STEPS + 50);
  assert.ok(tampered(endless, (f) => (f[6] = 100 * T.STEPS_PER_SECOND * 6)));
  assert.equal(
    tampered(endless, (f) => (f[6] = T.ENDLESS_STEPS)),
    undefined,
  );
});
