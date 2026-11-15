// #188: a rider exists only until it dies. Once a trail, a blast or another rider has ended it partway through the
// step, the rest of its step is not there for anyone to ride into. Contact that happened before the death still counts.
import assert from "node:assert/strict";
import test from "node:test";
import {
  COUNTDOWN_TICKS,
  RIDER_COLORS,
  addPlayer,
  createGame,
  startMatch,
  step,
  type GameState,
} from "../src/engine/game.ts";
import { createTickContext } from "../src/engine/sim/context.ts";
import { detectHazards } from "../src/engine/sim/phases/detect-hazards.ts";
import { detectRiderContacts } from "../src/engine/sim/phases/detect-rider-contacts.ts";
import { classicSettings } from "./fixtures/classic-settings.ts";

type Step = readonly [fromX: number, fromY: number, toX: number, toY: number];

function playing(count: number): GameState {
  const state = createGame("match", classicSettings());
  for (let slot = 0; slot < count; slot += 1)
    addPlayer(state, {
      id: `p${slot}`,
      name: `Player ${slot + 1}`,
      slot,
      color: RIDER_COLORS[slot]!,
    });
  startMatch(state);
  state.obstacles = [];
  for (let tick = 0; tick < COUNTDOWN_TICKS; tick += 1) step(state, new Map());
  assert.equal(state.phase, "playing");
  for (const player of state.players.values()) player.trail = [];
  return state;
}

/** The two contact phases over hand-placed steps, long enough to put events at chosen moments in the tick. */
function sweep(state: GameState, steps: Record<string, Step>) {
  const ctx = createTickContext(state, new Map());
  for (const [id, [oldX, oldY, x, y]] of Object.entries(steps)) {
    const player = state.players.get(id)!;
    ctx.movements.set(id, { player, oldX, oldY, x, y, angle: 0 });
  }
  detectHazards(ctx);
  detectRiderContacts(ctx);
  return ctx;
}

/** A long-standing trail of `p2`'s from (x, 300) to (x, 400): nobody's self-trail grace applies to it. */
function wallOfTrail(state: GameState, x: number): void {
  state.players.get("p2")!.trail = [
    {
      x1: x,
      y1: 300,
      x2: x,
      y2: 400,
      createdTick: state.tick - 100,
      expiresAtTick: state.tick + 100,
    },
  ];
}

// p0 rides east 500 → 530 along y 350. p1 comes down x 530 and stops 5 short of p0's end point: the two bodies
// are within reach of each other only at the very end of the step.
const late: Record<string, Step> = {
  p0: [500, 350, 530, 350],
  p1: [530, 300, 530, 345],
};

test("a rider that hit a trail early cannot kill a rider that reaches its untravelled path later", () => {
  const state = playing(3);
  wallOfTrail(state, 515); // p0 meets it about 0.3 of the way along
  const ctx = sweep(state, late);
  assert.equal(ctx.causes.get("p0"), "trail");
  assert.equal(
    ctx.causes.get("p1"),
    undefined,
    "p1 meets where p0 would have been",
  );
  assert.equal(ctx.riderContactTimes.size, 0);
});

test("a rider caught by a blast early cannot kill a rider that reaches its untravelled path later", () => {
  const state = playing(2);
  const ctx = createTickContext(state, new Map());
  ctx.fuseBlasts = [
    {
      bombId: 1,
      ownerId: "p0",
      circle: { x: 512, y: 370, radius: 15 },
      expiresAtTick: state.tick + 10,
    },
  ];
  for (const [id, [oldX, oldY, x, y]] of Object.entries(late)) {
    const player = state.players.get(id)!;
    ctx.movements.set(id, { player, oldX, oldY, x, y, angle: 0 });
  }
  detectHazards(ctx);
  const blastTime = ctx.hazardContactTimes.get("p0");
  assert.ok(
    blastTime !== undefined && blastTime > 0.05 && blastTime < 0.15,
    `p0 enters the blast early in the step, at ${blastTime}`,
  );
  assert.equal(ctx.hazardContactTimes.has("p1"), false);
  detectRiderContacts(ctx);
  assert.equal(ctx.causes.get("p0"), "explosion");
  assert.equal(ctx.causes.get("p1"), undefined);
});

test("a rider killed by one rider cannot go on to kill a third later in the step", () => {
  const state = playing(3);
  const ctx = sweep(state, {
    p0: [500, 350, 530, 350],
    p1: [512, 350, 482, 350], // head-on with p0, touching a tenth of the way in
    p2: [530, 300, 530, 345], // reaches p0's end point at the end of the step
  });
  assert.equal(ctx.causes.get("p0"), "rider");
  assert.equal(ctx.causes.get("p1"), "rider");
  assert.equal(ctx.causes.get("p2"), undefined);
  assert.deepEqual(
    [...ctx.causeOwners.get("p0")!.get("rider")!],
    ["p1"],
    "only p1 is behind p0's death",
  );
});

test("contact before a rider's death still kills both", () => {
  const state = playing(3);
  wallOfTrail(state, 527); // p0 meets it about 0.7 of the way along
  const ctx = sweep(state, {
    p0: [500, 350, 530, 350],
    p1: [515, 335, 515, 365], // on p0 at the midpoint
  });
  assert.equal(ctx.causes.get("p1"), "rider");
  assert.deepEqual([...ctx.causeOwners.get("p1")!.get("rider")!], ["p0"]);
  // p0 is marked by both; the trail outranks the rider as its cause.
  assert.equal(ctx.causes.get("p0"), "trail");
  assert.ok(ctx.causeOwners.get("p0")!.get("rider")!.has("p1"));
});

test("a shielded rider keeps its whole step, because its shield takes the trail", () => {
  const state = playing(3);
  wallOfTrail(state, 515);
  state.players.get("p0")!.shielded = true;
  const ctx = sweep(state, late);
  assert.equal(ctx.causes.get("p1"), "rider");
});
