import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_GAMEPLAY } from "../src/options/index.js";
import { fireWeapon } from "../src/ordnance/index.js";
import {
  createMission,
  isMissionState,
  stepMission,
} from "../src/sim/index.js";

test("health and density apply when a mission starts; duel players have the original fixed 500 HP", () => {
  const normal = createMission(15, ["a"], "campaign", 0);
  const gameplay = {
    ...DEFAULT_GAMEPLAY,
    playerHp: 150,
    npcHp: 200,
    density: 50,
  };
  const scaled = createMission(15, ["a"], "campaign", 0, { gameplay });
  const regular = (s: typeof scaled) =>
    s.actors.filter((a) => !a.seat && a.objectiveIndex === null);
  assert.equal(regular(scaled).length, Math.floor(regular(normal).length / 2));
  assert.equal(scaled.actors[0]!.hp, 300);
  const original = normal.actors.find(
    (a) => a.characterIndex === scaled.actors[1]!.characterIndex && !a.seat,
  )!;
  assert.equal(scaled.actors[1]!.hp, original.hp * 2);
  assert.equal(
    createMission(15, ["a", "b"], "dogfight", 0, { gameplay }).actors[0]!.hp,
    500,
  );
  gameplay.playerHp = 25;
  assert.equal(scaled.gameplay.playerHp, 150);
  assert.ok(isMissionState(scaled));
  assert.equal(
    isMissionState({
      ...scaled,
      gameplay: { ...scaled.gameplay, density: 101 },
    }),
    false,
  );
});

test("ordinary fire from another operative can hurt a teammate only with friendly fire enabled", () => {
  for (const friendlyFire of [false, true]) {
    let s = createMission(14, ["a", "b"], "campaign", 7, {
      gameplay: { ...DEFAULT_GAMEPLAY, friendlyFire },
    });
    s.actors = s.actors.filter((a) => a.seat);
    s.props = [];
    s.items = [];
    const target = s.actors[1]!;
    const shot = fireWeapon(1, s.actors[0]!.id, target.x, target.y, 0, () => 4)
      .shots[0]!;
    Object.assign(shot, { x: target.x - 1, y: target.y, dx: 1, dy: 0 });
    s.shots = [shot];
    s = stepMission(s, {});
    assert.equal(s.actors[1]!.hp, target.hp - (friendlyFire ? 10 : 0));
  }
});
