import assert from "node:assert/strict";
import test from "node:test";
import { validCheckpointLifecycle } from "../src/index.js";
import type { Stage } from "../src/index.js";

const human = { id: "human", bot: false };
const bot = { id: "bot", bot: true };
const roster = [human, bot];
const live = { players: roster, over: false };
const ended = { ...live, over: true };
const blank = {
  stage: "lobby",
  roster: [],
  held: {},
  hasDecision: false,
} as const;
const state = (stage: Stage, hasDecision = false) => ({
  stage,
  roster,
  held: {},
  hasDecision,
});

test("checkpoint world, stage and decision must agree, including between rounds", () => {
  assert.ok(validCheckpointLifecycle(blank, null));
  assert.ok(validCheckpointLifecycle(state("running"), live));
  assert.ok(validCheckpointLifecycle(state("between"), ended));
  assert.ok(validCheckpointLifecycle(state("over", true), ended));
  assert.equal(validCheckpointLifecycle(blank, live), false);
  assert.equal(validCheckpointLifecycle(state("lobby"), null), false);
  assert.equal(validCheckpointLifecycle(state("running"), null), false);
  assert.equal(validCheckpointLifecycle(state("running"), ended), false);
  assert.equal(validCheckpointLifecycle(state("between", true), ended), false);
  assert.equal(validCheckpointLifecycle(state("over"), ended), false);
  assert.equal(validCheckpointLifecycle(state("over", true), live), false);
});

test("checkpoint players match roster order and only active humans hold input", () => {
  const held = { human: 1 };
  assert.ok(validCheckpointLifecycle({ ...state("running"), held }, live));
  assert.ok(validCheckpointLifecycle({ ...state("between"), held }, ended));
  assert.equal(validCheckpointLifecycle({ ...blank, held }, null), false);
  assert.equal(
    validCheckpointLifecycle({ ...state("over", true), held }, ended),
    false,
  );
  assert.equal(
    validCheckpointLifecycle({ ...state("running"), held: { bot: 1 } }, live),
    false,
  );
  assert.equal(
    validCheckpointLifecycle({ ...state("running"), held: { gone: 1 } }, live),
    false,
  );
  for (const players of [[human], [bot, human], [human, { id: "other" }]])
    assert.equal(
      validCheckpointLifecycle(state("running"), { ...live, players }),
      false,
    );
});
