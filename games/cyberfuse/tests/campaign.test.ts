import assert from "node:assert/strict";
import test from "node:test";
import {
  CAMPAIGNS,
  DOGFIGHTS,
  MISSION_COUNT,
  PICKUP_SPRITES,
  PROP_DEFS,
  WEAPONS,
  defaultLoadout,
  getCampaignForMission,
  getMission,
} from "../src/campaign/index.js";

test("mission selection retains DOS campaign bounds, ordering and objectives", () => {
  assert.deepEqual(
    CAMPAIGNS.map((c) => [c.id, c.missions.length, c.characters.length]),
    [
      ["bem", 9, 29],
      ["ogre", 16, 42],
      ["distress", 18, 31],
      ["terror", 13, 29],
      ["zombie", 17, 38],
    ],
  );
  assert.equal(MISSION_COUNT, 73);
  assert.equal(getMission(0).title, "They are destroying our base!");
  assert.deepEqual(getMission(0).objectives, [
    {
      description: "Defeat the attack",
      kind: "kill",
      index: 0,
      count: 20,
      required: 15,
      flags: 0,
    },
  ]);
  assert.equal(getMission(9), getMission(0, 1));
  assert.equal(getMission(25).objectives[0]?.required, 80);
  assert.equal(getCampaignForMission(72).id, "zombie");
  assert.equal(getMission(72).title, "The clone that wouldn't go away...");
  for (const index of [-1, 0.5, MISSION_COUNT, NaN]) {
    assert.throws(() => getMission(index), RangeError);
    assert.throws(() => getCampaignForMission(index), RangeError);
  }
  assert.throws(() => getMission(9, 0), RangeError);
  assert.throws(() => getCampaignForMission(0, 5), RangeError);
});

test("every live mission reference resolves within its authored bank", () => {
  for (const [index, campaign] of CAMPAIGNS.entries()) {
    assert.equal(campaign.author, "Ronny Wester");
    for (const [local, mission] of campaign.missions.entries()) {
      assert.equal(getMission(local, index), mission);
      assert.equal(getCampaignForMission(local, index), campaign);
      for (const character of [...mission.enemies, ...mission.specials])
        assert.ok(campaign.characters[character], mission.title);
      for (const item of mission.items)
        assert.ok(PROP_DEFS[item.index], mission.title);
      for (const o of mission.objectives) {
        assert.ok(o.required <= o.count);
        if (o.kind === "destroy") assert.ok(PROP_DEFS[o.index]);
        if (o.kind === "collect") assert.ok(PICKUP_SPRITES[o.index]);
        if (o.kind === "rescue") assert.ok(campaign.characters[o.index]);
      }
      assert.ok(
        mission.allowedWeapons.length >= 1 &&
          mission.allowedWeapons.length <= 11,
      );
      for (const id of mission.allowedWeapons)
        assert.equal(WEAPONS[id]?.id, id);
    }
  }
});

test("DOS loadouts respect each mission and keep the independent arena configurations", () => {
  const first = getMission(0);
  assert.deepEqual(first.allowedWeapons, [0, 1, 3, 4, 5, 8]);
  assert.deepEqual(defaultLoadout(0, first), [4, 1]);
  assert.deepEqual(defaultLoadout(1, first), [5, 3]);
  assert.deepEqual(defaultLoadout(2, first), [4, 1]);
  assert.deepEqual(defaultLoadout(0, { ...first, allowedWeapons: [8] }), [8]);
  assert.deepEqual(
    DOGFIGHTS.map((m) => [m.title, m.width, m.height]),
    [
      ["Dogfight in the dungeon", 32, 32],
      ["Cubicle wars", 64, 64],
    ],
  );
  const ogre = getMission(0, 1);
  const terminal = PROP_DEFS[ogre.objectives[0]!.index]!;
  assert.deepEqual(terminal.sprite, { id: 361, dx: -8, dy: -17 });
  assert.equal(terminal.hp, 40);
  assert.equal(terminal.wreck?.id, 339);
});
