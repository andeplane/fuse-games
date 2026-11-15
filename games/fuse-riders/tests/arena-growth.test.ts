// Seven or eight riders get a bigger arena, so each has the floor six have on the standard one. Six or fewer play on
// the standard arena exactly as before.
import assert from "node:assert/strict";
import test from "node:test";
import {
  ARENA_HEIGHT,
  ARENA_WIDTH,
  COUNTDOWN_TICKS,
  INITIAL_BOUNDARY_INSET,
  MAX_ARENA_HEIGHT,
  MAX_ARENA_WIDTH,
  MAX_PLAYERS,
  OVERTIME_INSET_PER_TICK,
  OVERTIME_START_TICK,
  RIDER_COLORS,
  ROUND_DRAW_TICK,
  addPlayer,
  arenaSize,
  createGame,
  isArenaSize,
  overtimeInsetPerTick,
  setPlayerConnected,
  startMatch,
  startNextRound,
  step,
  type GameState,
} from "../src/engine/game.ts";
import {
  decodeGameState,
  encodeGameState,
} from "../src/engine/codec/checkpoint.ts";
import { initialBoundaryInset } from "../src/engine/arena-map.ts";
import { TRAIN_CAR_HALF_SIZE } from "../src/engine/scenery-motion.ts";
import { classicSettings } from "./fixtures/classic-settings.ts";
import { defaultRoomSettings } from "../src/engine/room-settings.ts";

function seated(riders: number, settings = classicSettings()): GameState {
  const state = createGame("arena-growth", settings, 7);
  for (let slot = 0; slot < riders; slot += 1)
    addPlayer(state, {
      id: `p${slot}`,
      name: `Player ${slot + 1}`,
      slot,
      color: RIDER_COLORS[slot]!,
    });
  return state;
}

test("the arena is standard up to six riders and grows to keep each rider's floor at seven and eight", () => {
  const perRider = (ARENA_WIDTH * ARENA_HEIGHT) / 6;
  for (let riders = 2; riders <= MAX_PLAYERS; riders += 1) {
    const { width, height } = arenaSize(riders);
    assert.ok(isArenaSize(width, height));
    if (riders <= 6) {
      assert.deepEqual([width, height], [ARENA_WIDTH, ARENA_HEIGHT]);
      continue;
    }
    assert.ok(
      Math.abs((width * height) / riders / perRider - 1) < 0.01,
      `${riders} riders keep the six-rider floor each`,
    );
    assert.ok(Math.abs(width / height - 16 / 9) < 0.01, "about 16:9");
    assert.ok(width <= MAX_ARENA_WIDTH && height <= MAX_ARENA_HEIGHT);
  }
  assert.deepEqual(arenaSize(8), {
    width: MAX_ARENA_WIDTH,
    height: MAX_ARENA_HEIGHT,
  });
  assert.equal(isArenaSize(1700, 900), false);
  assert.equal(isArenaSize(1848, 900), false, "width and height go together");
});

test("a round of eight is laid out on the grown arena, with every rider spawned around its centre", () => {
  const state = seated(8);
  startMatch(state);
  assert.deepEqual([state.width, state.height], [1848, 1040]);
  const centreX = state.width / 2,
    centreY = state.height / 2;
  const radius = 0.28 * state.height;
  for (const player of state.players.values())
    assert.ok(
      Math.abs(Math.hypot(player.x - centreX, player.y - centreY) - radius) <
        1e-6,
      `${player.id} starts on the spawn circle of the grown arena`,
    );
  // The round plays: it reaches the walls of the grown arena, not the standard one.
  for (let tick = 0; tick < COUNTDOWN_TICKS + 5; tick += 1)
    step(state, new Map());
  assert.equal(state.phase, "playing");
  assert.ok([...state.players.values()].every((player) => player.alive));
});

test("the arena follows each round's riders: seven, then back to standard when one leaves", () => {
  const state = seated(7);
  startMatch(state);
  assert.deepEqual([state.width, state.height], [1728, 972]);
  // A rider leaving mid-round does not resize the round being played.
  for (let tick = 0; tick < COUNTDOWN_TICKS + 1; tick += 1)
    step(state, new Map());
  setPlayerConnected(state, "p6", false);
  step(state, new Map());
  assert.deepEqual([state.width, state.height], [1728, 972]);
  state.phase = "roundOver";
  startNextRound(state);
  assert.deepEqual([state.width, state.height], [ARENA_WIDTH, ARENA_HEIGHT]);
});

test("overtime closes the same share of a grown arena by the draw as of the standard one", () => {
  assert.equal(
    overtimeInsetPerTick({ height: ARENA_HEIGHT }),
    OVERTIME_INSET_PER_TICK,
    "the standard arena keeps its exact rate",
  );
  const closedAtDraw = (height: number) =>
    (initialBoundaryInset("classic", INITIAL_BOUNDARY_INSET) +
      (ROUND_DRAW_TICK - OVERTIME_START_TICK) *
        overtimeInsetPerTick({ height })) /
    height;
  for (const riders of [7, 8]) {
    const { height } = arenaSize(riders);
    // The fixed initial inset is the only part that does not scale.
    assert.ok(
      Math.abs(closedAtDraw(height) - closedAtDraw(ARENA_HEIGHT)) < 0.01,
      `${riders} riders`,
    );
  }
});

test("the trains map centres its railway on a grown arena and keeps every rail on the board", () => {
  const settings = { ...defaultRoomSettings(), map: "trains" as const };
  for (const riders of [6, 8]) {
    const state = seated(riders, settings);
    startMatch(state);
    assert.equal(state.map, "trains");
    const points = state.tracks.flatMap((track) => track.points);
    assert.ok(points.length > 0);
    for (const point of points)
      assert.ok(
        point.x >= TRAIN_CAR_HALF_SIZE &&
          point.y >= TRAIN_CAR_HALF_SIZE &&
          point.x <= state.width - TRAIN_CAR_HALF_SIZE &&
          point.y <= state.height - TRAIN_CAR_HALF_SIZE,
      );
    if (riders === 8) {
      // The grid spans x 160–1440 and y 150–750 on the standard board; on the grown one it is moved to the middle.
      const minX = Math.min(...points.map((point) => point.x)),
        maxX = Math.max(...points.map((point) => point.x));
      assert.ok(minX >= 160 + (state.width - ARENA_WIDTH) / 2 - 1e-9);
      assert.ok(maxX <= 1440 + (state.width - ARENA_WIDTH) / 2 + 1e-9);
    }
  }
});

test("a checkpoint of an eight-rider round on the grown arena round-trips, and a board no round uses is refused", () => {
  const state = seated(8);
  startMatch(state);
  for (let tick = 0; tick < COUNTDOWN_TICKS + 20; tick += 1)
    step(state, new Map());
  const decoded = decodeGameState(encodeGameState(state));
  assert.ok(decoded, "the grown arena is a valid checkpoint");
  assert.deepEqual([decoded.width, decoded.height], [1848, 1040]);
  assert.equal(decoded.players.size, 8);
  for (const [width, height] of [
    [1700, 950],
    [1848, 900],
    [1600, 1040],
    // Boards some round uses, but not a round of eight.
    [1600, 900],
    [1728, 972],
  ] as const) {
    const tampered = JSON.parse(encodeGameState(state));
    const patch = (value: unknown): void => {
      if (value && typeof value === "object") {
        const record = value as Record<string, unknown>;
        if (record.width === 1848 && record.height === 1040) {
          record.width = width;
          record.height = height;
        }
        Object.values(record).forEach(patch);
      }
    };
    patch(tampered);
    assert.equal(
      decodeGameState(JSON.stringify(tampered)),
      undefined,
      `${width} × ${height} is refused`,
    );
  }
});
