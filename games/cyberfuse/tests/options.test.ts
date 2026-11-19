import assert from "node:assert/strict";
import test from "node:test";
import { Window } from "happy-dom";
import { createDifficulty } from "../src/app/difficulty.js";
import type { CyberfuseSettings } from "../src/game/index.js";
import { buildMission } from "../src/maps/index.js";
import {
  DIFFICULTIES,
  PERCENTAGES,
  DEFAULT_GAMEPLAY,
  decodeGameplayQuery,
  encodeGameplayQuery,
  parseGameplayOptions,
  scaledHp,
  enemyCount,
} from "../src/options/index.js";

test("DOS settings round-trip all five AI presets and eight percentage stops; invalid records reject atomically", () => {
  for (const difficulty of DIFFICULTIES)
    for (const n of PERCENTAGES) {
      const original = {
        difficulty,
        density: n,
        npcHp: n,
        playerHp: n,
        friendlyFire: true,
      };
      assert.deepEqual(parseGameplayOptions(original), original);
      assert.deepEqual(
        decodeGameplayQuery(encodeGameplayQuery(original)),
        original,
      );
    }
  for (const patch of [
    { difficulty: "legendary" },
    { density: 0 },
    { npcHp: 37 },
    { playerHp: 225 },
    { friendlyFire: 1 },
    { extra: true },
  ]) {
    assert.equal(
      parseGameplayOptions({ ...DEFAULT_GAMEPLAY, ...patch }),
      undefined,
    );
  }
  assert.equal(parseGameplayOptions({ difficulty: "hard" }), undefined);
  assert.equal(encodeGameplayQuery(DEFAULT_GAMEPLAY).size, 0);
  assert.equal(
    decodeGameplayQuery(new URLSearchParams("density=200&density=25")),
    undefined,
  );
  assert.equal(
    decodeGameplayQuery(new URLSearchParams("npcHp=50&friendlyFire=maybe")),
    undefined,
  );
  assert.equal(
    decodeGameplayQuery(new URLSearchParams("mission=3&solo=1")),
    undefined,
  );
});
test("ordinary enemy density scales independently of mission objectives and static props", () => {
  const sparse = buildMission(0, 1729, false, 0, 0, 1, 25);
  const packed = buildMission(0, 1729, false, 0, 0, 1, 200);
  assert.equal(
    sparse.enemies.filter((e) => e.objectiveIndex === undefined).length,
    2,
  );
  assert.equal(
    packed.enemies.filter((e) => e.objectiveIndex === undefined).length,
    20,
  );
  assert.deepEqual(
    sparse.enemies.filter((e) => e.objectiveIndex !== undefined),
    packed.enemies.filter((e) => e.objectiveIndex !== undefined),
  );
  assert.deepEqual(sparse.props, packed.props);
  assert.deepEqual(sparse.keys, packed.keys);
  assert.equal(enemyCount(1, 25), 1);
  assert.equal(scaledHp(15, 125), 18);
});
test("the shared difficulty panel emits host choices and reflects read-only guests and dogfights", async () => {
  const window = new Window();
  try {
    const doc = window.document as unknown as Document;
    let settings: CyberfuseSettings = { display: false, mode: "campaign" };
    let events = 0;
    const panel = createDifficulty(
      settings,
      (next) => {
        settings = next;
        events++;
        panel.update(next, true);
      },
      doc,
    );
    doc.body.append(panel.element);
    const control = <T extends HTMLElement>(name: string) =>
      panel.element.querySelector<T>('[name="' + name + '"]')!;
    const ai = control<HTMLSelectElement>("difficulty"),
      hp = control<HTMLSelectElement>("npcHp"),
      friendly = control<HTMLInputElement>("friendlyFire");
    const dispatch = (input: HTMLElement) => {
      const event = doc.createEvent("Event");
      event.initEvent("change", true, false);
      input.dispatchEvent(event);
    };
    ai.value = "very hard";
    dispatch(ai);
    hp.value = "175";
    dispatch(hp);
    friendly.checked = true;
    dispatch(friendly);
    assert.equal(events, 3);
    assert.deepEqual(settings.gameplay, {
      ...DEFAULT_GAMEPLAY,
      difficulty: "very hard",
      npcHp: 175,
      friendlyFire: true,
    });
    panel.update(settings, false);
    assert.ok(ai.disabled && hp.disabled && friendly.disabled);
    ai.value = "easy";
    dispatch(ai);
    assert.equal(events, 3);
    panel.update({ ...settings, mode: "dogfight" }, true);
    assert.equal(panel.element.hidden, true);
    panel.update({ display: true, mode: "campaign" }, true);
    assert.equal(ai.value, "normal");
    assert.equal(hp.value, "100");
    assert.equal(friendly.checked, false);
  } finally {
    await window.happyDOM.close();
  }
});
