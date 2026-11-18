import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { fireWeapon } from "../src/ordnance/index.js";
import test from "node:test";
import {
  createMission,
  isMissionState,
  REST,
  stepMission,
  type Control,
  type MissionState,
} from "../src/sim/index.js";

function corridor(): MissionState {
  const s = createMission(17, ["blue"], "campaign", 7, {
    loadouts: { blue: [1, 4, 5] },
  });
  s.actors = s.actors.filter((a) => a.seat);
  const a = s.actors[0]!;
  Object.assign(a, { x: 120, y: 120, dir: 4, inventory: [1, 4, 5], weapon: 1 });
  s.tiles = Array.from({ length: 64 }, (_, y) =>
    Array.from({ length: 64 }, (_, x) =>
      x < 1 || x >= 12 || y < 1 || y >= 15
        ? "#"
        : x === 11 && y >= 8 && y <= 11
          ? "E"
          : ".",
    ).join(""),
  );
  s.props = [];
  s.doors = [];
  s.keys = [];
  s.keyring = [];
  s.seen = s.tiles.map((row) => "0".repeat(row.length));
  s.seenCount = 0;
  s.items = [
    {
      x: 136,
      y: 120,
      id: "jewel",
      kind: "core",
      hp: 1,
      objectiveIndex: 0,
      sprite: 43,
      escort: null,
      objectFlags: 0,
      solid: false,
    },
  ];
  s.objectives = [
    {
      kind: "collect",
      description: "Recover the jewel",
      count: 1,
      required: 1,
      done: 0,
      flags: 0,
    },
  ];
  s.objective = s.objectives[0]!;
  return s;
}
function scenario(t: number): Control {
  const cmd =
    t <= 4
      ? 2
      : t === 5
        ? 18
        : t === 6
          ? 34
          : t === 7
            ? 2
            : t === 8
              ? 20
              : t >= 55 && t < 62
                ? 6
                : t === 62
                  ? 32
                  : t >= 90 && t < 96
                    ? 2
                    : 0;
  return {
    dx: cmd & 2 ? 1 : 0,
    dy: cmd & 4 ? -1 : 0,
    fire: !!(cmd & 16),
    special: !!(cmd & 32),
  };
}
test("actor and extraction trace matches the compiled DOS functions for every tick of a mission", () => {
  let s = corridor();
  const rows: string[] = [];
  for (let t = 1; t <= 600 && s.outcome === "playing"; t++) {
    s = stepMission(s, { blue: scenario(t) });
    const a = s.actors[0]!;
    rows.push(
      [
        t,
        256 * a.x,
        256 * a.y,
        256 * a.slideX,
        256 * a.slideY,
        a.dir,
        a.weapon,
        s.objectives[0]!.done,
        s.extraction,
      ].join(","),
    );
  }
  assert.equal(s.outcome, "victory");
  assert.deepEqual(s.winners, ["blue"]);
  assert.equal(s.tick, 368);
  assert.equal(
    createHash("sha256")
      .update(rows.join("\n") + "\n")
      .digest("hex"),
    "b0651a703ec77580818b01cf5eb9c2236d5ef9462aa9cdc146b0710b2e973859",
  );
});
test("JSON checkpoint restores an in-flight slide, shot, fog, score and extraction", () => {
  let s = corridor();
  const original = JSON.stringify(s);
  let cursor = s;
  for (let t = 1; t <= 8; t++)
    cursor = stepMission(cursor, { blue: scenario(t) });
  assert.equal(JSON.stringify(s), original);
  const parsed: unknown = JSON.parse(JSON.stringify(cursor));
  assert.ok(isMissionState(parsed));
  s = parsed;
  for (let t = 9; t <= 368; t++) {
    s = stepMission(s, { blue: scenario(t) });
    cursor = stepMission(cursor, { blue: scenario(t) });
  }
  assert.deepEqual(s, cursor);
});
test("every campaign loads a bounded checkpoint, with its source objective descriptions", () => {
  for (let mission = 0; mission < 73; mission++) {
    const s = createMission(109, ["a", "b"], "campaign", mission);
    assert.ok(isMissionState(s), "create " + mission);
    assert.ok(isMissionState(stepMission(s, {})), "advance " + mission);
    assert.equal(s.actors.filter((a) => a.seat !== null).length, 2);
  }
});
test("a dogfight waits for pickup after the last opponent falls; simultaneous deaths are a draw", () => {
  let state = createMission(17, ["red", "blue"], "dogfight");
  const [, blue] = state.actors;
  assert.equal(blue!.hp, 500);
  blue!.hp = 0;
  blue!.deathTick = 0;
  let drawn = structuredClone(state);
  drawn.actors[0]!.hp = 0;
  drawn.actors[0]!.deathTick = 0;
  drawn = stepMission(drawn, {});
  assert.equal(drawn.outcome, "defeat");
  assert.deepEqual(drawn.winners, []);
  for (let i = 0; i < 350; i++) state = stepMission(state, {});
  assert.equal(state.outcome, "victory");
  assert.deepEqual(state.winners, ["red"]);
});
test("leaving extraction resets pickup time; locked doors require their shared key", () => {
  let s = corridor();
  const a = s.actors[0]!;
  a.x = 180;
  s.items = [];
  s.objectives[0]!.done = 1;
  for (let i = 0; i < 24; i++) s = stepMission(s, {});
  assert.equal(s.extraction, 24);
  for (let i = 0; i < 8; i++) s = stepMission(s, { blue: { ...REST, dx: -1 } });
  assert.equal(s.extraction, 0);
  s.doors = [{ x: 10, y: 10, horizontal: false, key: "blue", timer: 0 }];
  s.tiles[10] = s.tiles[10]!.slice(0, 10) + "D" + s.tiles[10]!.slice(11);
  s = stepMission(s, {});
  assert.equal(s.doors[0]!.timer, 0);
  s.keyring = ["blue"];
  s = stepMission(s, {});
  assert.equal(s.tiles[10]![10], "+");
});
test("checkpoint rejects corrupt references, unknown nested payloads, oversized geometry and partial records", () => {
  const s = corridor();
  assert.ok(isMissionState(s));
  assert.equal(
    isMissionState({ ...s, actors: [s.actors[0], s.actors[0]] }),
    false,
  );
  assert.equal(isMissionState({ ...s, props: [{ x: 0 }] }), false);
  assert.equal(isMissionState({ ...s, seenCount: s.seenCount + 1 }), false);
  assert.equal(isMissionState({ ...s, tiles: [...s.tiles, "#"] }), false);
  assert.equal(
    isMissionState({ ...s, actors: [{ ...s.actors[0], slideX: Infinity }] }),
    false,
  );
  assert.equal(
    isMissionState({ ...s, items: [{ ...s.items[0], payload: {} }] }),
    false,
  );
});
test("holding fire turns and shoots on the DOS gun lock without walking", () => {
  let s = corridor();
  const times: number[] = [];
  for (let t = 1; t <= 20; t++) {
    s = stepMission(s, { blue: { ...REST, dx: 1, fire: true } });
    const a = s.actors[0]!;
    assert.equal(a.x, 120);
    assert.equal(a.dir, 2);
    if (a.lastShot === t) times.push(t);
  }
  assert.deepEqual(times, [1, 7, 13, 19]);
});
test("destroying an ordinary box, explosive barrel, flammable barrel and poison barrel applies the map flags", () => {
  for (const [flags, expected] of [
    [6, null],
    [7, "fireball"],
    [4102, "firePatch"],
    [8198, "gas"],
  ] as const) {
    let s = corridor();
    const shot = fireWeapon(1, "player-0", 140, 120, 2, () => 4).shots[0]!;
    s.shots = [shot];
    s.props = [
      {
        x: Math.floor(shot.x + shot.dx),
        y: Math.floor(shot.y + shot.dy),
        kind: "test prop",
        w: 4,
        h: 3,
        hp: 1,
        impassable: true,
        objectIndex: 0,
        objectFlags: flags,
      },
    ];
    s = stepMission(s, {});
    assert.equal(s.props.length, 0);
    const secondary = s.shots.filter((x) => x.kind !== "spark");
    assert.ok(
      expected
        ? secondary.length > 0 && secondary.every((x) => x.kind === expected)
        : secondary.length === 0,
    );
  }
});
test("reinforcements replace expired NPC corpses at the source density, outside the 150-pixel radius", () => {
  let s = createMission(19, ["blue"]);
  const player = s.actors[0]!;
  s.actors = s.actors.filter(
    (a) => a.seat !== null || a.objectiveIndex === null,
  );
  const npc = s.actors.find((a) => a.seat === null)!;
  npc.hp = 0;
  npc.deathTick = 0;
  const id = s.nextEnemy;
  for (let t = 1; t <= 36; t++) {
    s = stepMission(s, {});
    assert.equal(s.nextEnemy, id);
  }
  const next = stepMission(s, {});
  assert.equal(next.nextEnemy, id + 1);
  assert.ok(!next.actors.some((a) => a.id === npc.id));
  const replacement = next.actors.find((a) => a.id === "enemy-" + id)!;
  assert.ok(
    Math.max(
      Math.abs(player.x - replacement.x),
      Math.abs(player.y - replacement.y),
    ) >= 150,
  );
  assert.ok(isMissionState(next));
  const restored: unknown = JSON.parse(JSON.stringify(s));
  assert.ok(isMissionState(restored));
  assert.deepEqual(stepMission(restored, {}), next);
});
