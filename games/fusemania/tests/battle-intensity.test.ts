import test from "node:test";
import assert from "node:assert/strict";
import {
  BATTLE_MODE,
  FLIP,
  WAVE,
  MINES,
  FADE,
  PINGPONG,
  ITEM_KINDS,
  ITEM_SCALABLE,
  USE,
  addEffect,
  attackIntensity,
  cloneWorld,
  createWorld,
  decodeWorld,
  encodeWorld,
  effectIntensity,
  stepWorld,
  turnedMine,
  type Effect,
} from "../src/engine/index.js";
import { testLibrary } from "./fixtures/songs.js";
import { modsAt } from "../src/render/mods.js";
import { songShape } from "../src/app/song-fx.js";

test("every mod has a classification; pressure follows the recipient's gap to first", () => {
  assert.equal(ITEM_SCALABLE.length, ITEM_KINDS);
  assert.equal(ITEM_SCALABLE[FLIP], false);
  assert.equal(attackIntensity([0, 0], 1, 0), 600);
  assert.equal(attackIntensity([500_000, 450_000], 1, 0), 400);
  assert.equal(attackIntensity([500_000, 300_000], 1, 0), 200);
  const leader = Array.from({ length: 8 }, (_, roll) =>
    attackIntensity([500_000, 300_000], 0, roll),
  );
  assert.deepEqual(leader, [1000, 600, 600, 600, 1000, 600, 600, 600]);
  assert.equal(attackIntensity([500_000, 500_000], 0, 0), 600);
});

test("throw intensity is checkpointed per target, replays identically and Flip stays whole", () => {
  const library = testLibrary();
  const state = createWorld(
    library,
    "grid",
    BATTLE_MODE,
    1234,
    [0, 1, 2].map((id) => ({ id: `p${id}`, chart: 0, bot: false })),
    1000,
  )!;
  state.players[0]!.item = WAVE;
  state.ms = 1000;
  state.players[1]!.score = 10;
  const replay = cloneWorld(state);
  const inputs = [{ slot: 0, code: USE, ms: 1050 }];
  stepWorld(library, state, inputs);
  stepWorld(library, replay, inputs);
  assert.deepEqual(encodeWorld(state), encodeWorld(replay));
  assert.ok(
    effectIntensity(state.players[2]!.effects[0]!) <
      effectIntensity(state.players[1]!.effects[0]!),
  );
  const saved = encodeWorld(state);
  assert.deepEqual(decodeWorld(library, saved), state);
  for (const invalid of [-1, 1001, 0.5, null]) {
    const bad = structuredClone(saved);
    // Encode is intentionally a boundary payload; navigate the real serialized shape.
    const replace = (value: unknown): boolean => {
      if (!Array.isArray(value)) return false;
      if (value.length === 5 && value[0] === WAVE && value[3] === 0) {
        value[4] = invalid;
        return true;
      }
      return value.some(replace);
    };
    assert.ok(replace(bad));
    assert.equal(decodeWorld(library, bad), undefined);
  }
  state.players[0]!.item = FLIP;
  stepWorld(library, state, [{ slot: 0, code: USE, ms: 1100 }]);
  assert.equal(modsAt(state.players[2]!.effects, 3000).flip, 1);
});

test("amplitude scales visuals, audio and mines without retroactively strengthening an earlier effect", () => {
  assert.equal(modsAt([[WAVE, 0, 9000, 1, 200]], 2000).wave, 0.2);
  assert.equal(modsAt([[FLIP, 0, 9000, 1, 200]], 2000).flip, 1);
  assert.ok(songShape([[FADE, 0, 9000, 1, 200]], 3000, 0).level > 0.8);
  assert.ok(
    Math.abs(songShape([[PINGPONG, 0, 9000, 1, 200]], 3000, 0).pan) < 0.2,
  );
  const library = testLibrary();
  const state = createWorld(
    library,
    "grid",
    BATTLE_MODE,
    1234,
    [{ id: "p", chart: 0, bot: false }],
    1000,
  )!;
  const player = state.players[0]!;
  addEffect(player, WAVE, 0, 4000, 0, 200);
  addEffect(player, WAVE, 2000, 6000, 0, 600);
  assert.equal(modsAt(player.effects, 1000).wave, 0.2);
  assert.equal(modsAt(player.effects, 3000).wave, 0.6);
  const steps = library.steps("grid", 0)!;
  const mines = (intensity: number) =>
    steps.notes.flatMap((note, id) =>
      turnedMine([[MINES, -1000, 60_000, 0, intensity]], 1234, id, note)
        ? [id]
        : [],
    );
  assert.ok(mines(200).length < mines(1000).length);
  assert.ok(mines(200).every((id) => mines(1000).includes(id)));
  const legacy: Effect[] = [[WAVE, 0, 9000, 0]];
  assert.equal(modsAt(legacy, 2000).wave, 1);
});
