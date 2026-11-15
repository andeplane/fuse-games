import test from "node:test";
import assert from "node:assert/strict";
import {
  DUCK,
  HIGH,
  JUMP,
  LOW,
  TALL,
  clears,
  planInput,
  sendsTall,
  toView,
  type Rules,
  type World,
} from "../src/engine/index.js";
import * as T from "../src/engine/tuning.js";
import { cuesBetween } from "../src/render/cues.js";
import {
  A,
  B,
  fresh,
  playing,
  steps,
  surge,
  ticks,
  until,
} from "./fixtures/world.js";

/** The switchable rules all off: the game as it was before them. */
const PLAIN: Partial<Rules> = {
  double: false,
  tall: false,
  boss: false,
  glide: false,
};

/** How high a rider gets and how long it is off the deck, holding `bits` step by step. */
function flight(world: World, bits: (step: number, world: World) => number) {
  let peak = 0,
    count = 0;
  do {
    steps(world, 1, bits(count, world));
    peak = Math.max(peak, world.riders[0]!.y);
    count++;
  } while (world.riders[0]!.y > 0 && count < 2000);
  return { peak: peak / T.U, steps: count };
}

test("the double jump: one more jump in the air, once until landing, and only where the rule is on", () => {
  // Hold the first jump to its top, let go, press again.
  const twice = (step: number) => (step < 36 || step > 40 ? JUMP : 0);
  const on = flight(playing({ ...PLAIN, double: true }), twice);
  const off = flight(playing(PLAIN), twice);
  assert.ok(off.peak > 140 && off.peak < 150, `a single jump: ${off.peak}`);
  assert.ok(on.peak > 240 && on.peak < 265, `two jumps: ${on.peak}`);
  assert.ok(on.peak * T.U < T.MAX_Y, "inside what a checkpoint holds");
  // It is spent until the rider lands: a third press in the air lifts nothing.
  const world = playing({ ...PLAIN, double: true });
  steps(world, 30, JUMP);
  steps(world, 2, 0);
  steps(world, 1, JUMP);
  const rider = world.riders[0]!;
  assert.equal(rider.jumps, 1);
  assert.equal(toView(world).riders[0]!.doubled, true);
  const rising = rider.vy;
  steps(world, 2, 0);
  steps(world, 1, JUMP);
  assert.ok(rider.vy < rising, "no third jump");
  until(world, (w) => w.riders[0]!.y === 0, 400);
  assert.equal(rider.jumps, 0, "landing gives it back");
  assert.equal(toView(world).riders[0]!.doubled, false);
  // A tapped second jump is a hop, like a tapped first one.
  const tap = flight(playing({ ...PLAIN, double: true }), (step) =>
    step < 36 || (step > 40 && step < 44) ? JUMP : 0,
  );
  assert.ok(tap.peak < on.peak - 40, `a tap adds little: ${tap.peak}`);
  // The picture hears it once.
  const before = playing({ ...PLAIN, double: true });
  steps(before, 30, JUMP);
  steps(before, 2, 0);
  const a = toView(before);
  steps(before, 1, JUMP);
  assert.deepEqual(
    cuesBetween(a, toView(before)).filter((cue) => cue.kind === "double"),
    [{ kind: "double", slot: 0 }],
  );
});

test("the glide: holding jump while falling comes down softly; letting go or diving does not", () => {
  const held = () => JUMP;
  const plain = flight(playing(PLAIN), held);
  const glide = flight(playing({ ...PLAIN, glide: true }), held);
  assert.ok(plain.steps > 80 && plain.steps < 88);
  assert.ok(glide.steps > 170, `a held glide hangs: ${glide.steps}`);
  assert.ok(Math.abs(glide.peak - plain.peak) < 1, "it adds no height");
  // Let go at the top and it falls like any jump; duck and it dives.
  const released = flight(playing({ ...PLAIN, glide: true }), (step) =>
    step < 42 ? JUMP : 0,
  );
  assert.ok(released.steps < 90, `${released.steps}`);
  const dived = flight(playing({ ...PLAIN, glide: true }), (step) =>
    step < 42 ? JUMP : DUCK,
  );
  assert.ok(dived.steps < released.steps);
  // Gliding never falls faster than its limit.
  const world = playing({ ...PLAIN, glide: true });
  steps(world, 70, JUMP);
  assert.ok(world.riders[0]!.vy >= -T.GLIDE_FALL_V);
});

test("a high surge floats: ducked heads pass under it and feet above its top pass over it", () => {
  const world = playing(PLAIN);
  const rider = world.riders[0]!;
  const at = (y: number, duck = false) => clears({ ...rider, y, duck }, HIGH);
  assert.equal(at(0), false, "standing is struck");
  assert.equal(at(0, true), true, "ducking fits under");
  assert.equal(at(30 * T.U), false, "a hop is struck");
  assert.equal(at(T.HIGH_TOP), false, "feet at its top are struck");
  assert.equal(at(T.HIGH_TOP + 1), true, "feet above it pass over");
  // A held jump timed so its very top is over the surge clears it; the same jump a moment late is struck.
  const speed = 560;
  const over = playing(PLAIN);
  surge(over, HIGH, 0, { x: T.START_X + T.REACH + 33 * speed });
  steps(over, 90, JUMP);
  assert.equal(over.riders[0]!.taken, 0, "over the top at the jump's peak");
  assert.equal(over.riders[0]!.dodges, 1);
  const late = playing(PLAIN);
  surge(late, HIGH, 0, { x: T.START_X + T.REACH + 8 * speed });
  steps(late, 90, JUMP);
  assert.equal(late.riders[0]!.taken, 1, "still rising: struck");
});

test("a tall surge stands from the deck up: only a double jump clears it", () => {
  const world = playing({ ...PLAIN, double: true, tall: true });
  const rider = world.riders[0]!;
  const at = (y: number, duck = false) => clears({ ...rider, y, duck }, TALL);
  assert.equal(at(0), false);
  assert.equal(at(0, true), false, "there is no ducking it");
  assert.equal(at(149 * T.U), false, "a single jump's top is not enough");
  assert.equal(at(T.TALL_TOP), false);
  assert.equal(at(T.TALL_TOP + 1), true);
  assert.ok(T.TALL_TOP > T.HIGH_TOP && T.HIGH_TOP > T.HIGH_BOTTOM);
  // The sound plan takes it with two jumps; one held jump, however timed, is struck.
  surge(world, TALL, 260);
  ticks(world, 60, planInput, (w) => w.surges.length === 0);
  assert.deepEqual(
    world.riders.map((each) => [each.taken, each.dodges]),
    [
      [0, 1],
      [0, 1],
    ],
  );
  for (const lead of [6, 14, 24, 36, 48]) {
    const single = playing({ ...PLAIN, double: true, tall: true });
    surge(single, TALL, 0, { x: T.START_X + T.REACH + lead * 560 });
    steps(single, 120, JUMP);
    assert.equal(single.riders[0]!.taken, 1, `one jump, ${lead} steps ahead`);
  }
  // Where the double jump is off the rule sends none, whatever the switch says.
  assert.equal(sendsTall({ ...world.rules, double: false, tall: true }), false);
  assert.equal(sendsTall({ ...world.rules, double: true, tall: false }), false);
  assert.equal(sendsTall(world.rules), true);
});

test("a bolt runs down one lane: it is nothing to the riders beside it", () => {
  const world = playing({ ...PLAIN, boss: true }, [A, B, "c"]);
  surge(world, LOW, 60, { lane: 1 });
  until(world, (w) => w.surges.length === 0, 2000);
  assert.deepEqual(
    world.riders.map((rider) => [rider.taken, rider.dodges]),
    [
      [0, 0],
      [1, 0],
      [0, 0],
    ],
    "the rider in its lane stood still and was struck; the others neither dodged nor were touched",
  );
  // Its own rider clears it like a surge of its height, and that counts as a dodge.
  for (const [kind, bits] of [
    [LOW, JUMP],
    [HIGH, DUCK],
  ] as const) {
    const lane = playing({ ...PLAIN, boss: true }, [A, B, "c"]);
    surge(lane, kind, 50, { lane: 2 });
    until(lane, (w) => w.surges.length === 0, 2000, 0, 0, bits);
    assert.deepEqual(
      lane.riders.map((rider) => [rider.taken, rider.dodges]),
      [
        [0, 0],
        [0, 0],
        [0, 1],
      ],
    );
  }
  // The plan reads only its own lane.
  const plan = playing({ ...PLAIN, boss: true }, [A, B]);
  surge(plan, HIGH, 10, { lane: 1 });
  assert.equal(planInput(plan, 0), 0);
  assert.equal(planInput(plan, 1), DUCK);
});

/** Everything the deck sends in a round of sound play: each spawn as the step it came at and what it was. */
function spawns(rules: Partial<Rules>, seed: number) {
  const world = fresh({ hits: 9, target: 1, recover: false, ...rules }, seed, [
    A,
    B,
    "c",
  ]);
  const seen = new Set<number>();
  const sent: { step: number; kind: number; lane: number; x: number }[] = [];
  /** Whether a tall surge was announced as next, tick by tick. */
  const announced: { step: number; next: boolean }[] = [];
  ticks(world, 2500, planInput, (w) => {
    for (const each of w.surges)
      if (!seen.has(each.id)) {
        seen.add(each.id);
        sent.push({
          step: w.clock,
          kind: each.kind,
          lane: each.lane,
          x: each.x,
        });
      }
    announced.push({ step: w.clock, next: w.tallNext });
    return w.phase === "break";
  });
  return { world, sent, announced };
}

test("the Warden's volleys and the tall surges come only where their rules are on, and a tall one is announced", () => {
  const plain = spawns(PLAIN, 11);
  assert.ok(plain.sent.length > 80);
  assert.ok(plain.sent.every((each) => each.lane === -1 && each.kind !== TALL));
  assert.ok(plain.announced.every((tick) => !tick.next));

  const boss = spawns({ ...PLAIN, boss: true }, 11);
  const bolts = boss.sent.filter((each) => each.lane >= 0);
  assert.ok(bolts.length > 20, `bolts: ${bolts.length}`);
  assert.ok(bolts.every((each) => each.kind !== TALL && each.lane < 3));
  assert.ok(bolts.some((each) => each.kind === LOW));
  assert.ok(bolts.some((each) => each.kind === HIGH));
  // Every volley has at least one bolt, and sooner or later one for every lane and one for only some.
  const sizes = new Map<number, number>();
  for (const bolt of bolts)
    sizes.set(bolt.step, (sizes.get(bolt.step) ?? 0) + 1);
  assert.ok([...sizes.values()].includes(3));
  assert.ok([...sizes.values()].some((size) => size < 3));
  assert.ok(
    boss.sent.some((each) => each.lane === -1),
    "surges still come",
  );
  // None before the curve lets the Warden in.
  assert.ok(bolts[0]!.step >= T.BOSS_FROM);

  const tall = spawns({ ...PLAIN, double: true, tall: true }, 11);
  const talls = tall.sent.filter((each) => each.kind === TALL);
  assert.ok(talls.length > 5, `tall surges: ${talls.length}`);
  for (const each of talls) {
    const index = tall.sent.indexOf(each);
    const before = tall.sent[index - 1]!,
      after = tall.sent[index + 1];
    // Announced from the moment the spawn before it left the arch, with clear deck before it and after it.
    const waiting = tall.announced.filter(
      (tick) => tick.step > before.step && tick.step < each.step,
    );
    assert.ok(waiting.length >= 20 && waiting.every((tick) => tick.next));
    assert.ok(each.step - before.step >= T.TALL_REST, "clear deck before");
    if (after) assert.ok(after.step - each.step >= T.TALL_REST, "and after");
    assert.equal(each.lane, -1);
  }
  assert.equal(
    tall.world.riders.every((rider) => rider.taken === 0),
    true,
  );
  // The switch alone sends none: without the double jump nothing could clear them.
  const idle = spawns({ ...PLAIN, tall: true }, 11);
  assert.ok(idle.sent.every((each) => each.kind !== TALL));

  // The picture is told: a volley once with its lanes, and a tall surge before it comes.
  const world = fresh(
    { ...PLAIN, boss: true, double: true, tall: true, hits: 9 },
    5,
    [A, B],
  );
  const kinds = new Set<string>();
  let last = toView(world),
    lanes = 0;
  ticks(world, 1500, planInput, (w) => {
    const view = toView(w);
    for (const cue of cuesBetween(last, view)) {
      kinds.add(cue.kind);
      if (cue.kind === "volley") lanes = Math.max(lanes, cue.lanes.length);
    }
    last = view;
    return w.phase === "break";
  });
  assert.ok(kinds.has("volley") && kinds.has("tall") && kinds.has("double"));
  assert.equal(lanes, 2);
});

test("an endless round has no clock: it is played until one rider is left", () => {
  const world = fresh({ ...PLAIN, seconds: 0, hits: 9, target: 1 }, 21);
  ticks(
    world,
    3600,
    planInput,
    (w) => w.phase !== "ready" && w.phase !== "play",
  );
  // Three minutes in, past where any timed round ends, sound play is still standing and nothing has called time.
  assert.equal(world.phase, "play");
  assert.ok(world.clock > 170 * T.STEPS_PER_SECOND);
  const view = toView(world);
  assert.equal(view.endless, true);
  assert.equal(view.elapsed, world.clock);
  assert.equal(toView(fresh(PLAIN)).endless, false);
  // It ends the way every round can: the last rider standing takes it.
  const short = fresh({ ...PLAIN, seconds: 0, hits: 1, target: 1 }, 21);
  ticks(
    short,
    3000,
    (w, slot) => (slot === 0 ? planInput(w, slot) : 0),
    (w) => w.phase === "break",
  );
  assert.equal(short.lastReason, "last");
  assert.equal(short.lastWinners, 1);
});
