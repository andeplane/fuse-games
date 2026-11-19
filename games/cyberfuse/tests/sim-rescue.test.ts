import assert from "node:assert/strict";
import test from "node:test";
import { CAMPAIGNS, getMission } from "../src/campaign/index.js";
import { fireWeapon } from "../src/ordnance/index.js";
import {
  createMission,
  stepMission,
  isMissionState,
  REST,
  type MissionState,
} from "../src/sim/index.js";

const ogreRescue = CAMPAIGNS[1]!.missions.findIndex((m) =>
  m.objectives.some((o) => o.kind === "rescue"),
);
function scenario() {
  const actual = createMission(99, ["p"], "campaign", ogreRescue, {
    campaign: 1,
  });
  const hostage = actual.actors.find((a) => a.role === "hostage")!;
  assert.equal(
    hostage.characterIndex,
    getMission(ogreRescue, 1).objectives[hostage.objectiveIndex!]!.index,
  );
  assert.equal(
    hostage.maxHp,
    CAMPAIGNS[1]!.characters[hostage.characterIndex]!.hp,
  );
  const s = createMission(27, ["p"], "campaign", 7);
  s.actors = [s.actors[0]!, { ...hostage, objectiveIndex: 0, x: 134, y: 120 }];
  Object.assign(s.actors[0]!, { x: 120, y: 120, inventory: [1], weapon: 1 });
  s.tiles = Array.from({ length: 64 }, (_, y) =>
    Array.from({ length: 64 }, (_, x) =>
      x > 0 && x < 15 && y > 0 && y < 15 ? (x < 7 ? "E" : ".") : "#",
    ).join(""),
  );
  s.items = [];
  s.keys = [];
  s.doors = [];
  s.props = [];
  s.seen = s.tiles.map((r) => "0".repeat(r.length));
  s.seenCount = 0;
  s.objectives = [
    {
      kind: "rescue",
      description: "Bring the captive to extraction",
      required: 1,
      count: 1,
      done: 0,
      flags: 0,
    },
  ];
  s.objective = s.objectives[0]!;
  return s;
}
test("a captive is a solid character; bump releases once, then the follower must reach the exit alive", () => {
  let s = scenario();
  const original = structuredClone(s);
  s = stepMission(s, { p: { ...REST, dx: 1 } });
  const captive = s.actors[1]!;
  assert.equal(s.actors[0]!.x, 120);
  assert.equal(s.objectives[0]!.done, 1);
  assert.equal(captive.escort, "player-0");
  assert.equal(captive.skill.flags & (1 << 18), 0);
  assert.ok(original.actors[1]!.skill.flags & (1 << 18));
  assert.equal(s.extraction, 0);
  const saved: unknown = JSON.parse(JSON.stringify(s));
  assert.ok(isMissionState(saved));
  function exit(state: MissionState) {
    for (let i = 0; i < 500 && state.outcome === "playing"; i++)
      state = stepMission(state, { p: { ...REST, dx: i < 83 ? -1 : 0 } });
    return state;
  }
  const end = exit(s);
  assert.equal(end.outcome, "victory");
  assert.ok(end.actors[1]!.x < 112);
  assert.deepEqual(end, exit(saved));
});
test("a lethal hit to a required vulnerable prisoner ends rescue; a source invulnerable prisoner survives it", () => {
  for (const invulnerable of [false, true]) {
    let s = scenario();
    const captive = s.actors[1]!;
    captive.hp = 1;
    if (invulnerable)
      captive.skill = {
        ...captive.skill,
        flags: captive.skill.flags | (1 << 19),
      };
    const shot = fireWeapon(1, "player-0", 150, 120, 6, () => 4).shots[0]!;
    shot.x = captive.x + 3;
    shot.y = captive.y;
    shot.dx = -3;
    shot.dy = 0;
    s.shots = [shot];
    s = stepMission(s, {});
    assert.equal(s.actors[1]!.hp, invulnerable ? 1 : 0);
    assert.equal(s.outcome, invulnerable ? "playing" : "defeat");
    assert.equal(s.objectives[0]!.done, 0);
    assert.equal(s.actors[0]!.kills, invulnerable ? 0 : 1);
    assert.ok(isMissionState(s));
  }
});
