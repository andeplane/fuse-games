import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  CAMPAIGNS,
  DOGFIGHTS,
  KEY_SPRITES,
  MISSION_COUNT,
  PROP_DEFS,
  getMission,
} from "../src/campaign/index.js";
import { buildMission } from "../src/maps/index.js";
import { COLORS, DosRandom, geometry } from "../src/maps/layout.js";

const digest = (value: Buffer | string) =>
  createHash("sha256").update(value).digest("hex");

test("DOS 1.06 geometry, access values and extraction rectangle agree with the independent C probe", () => {
  const cases = [
    [
      [0, 48, 48, 20, 20, 10, 3],
      "3e3133556e288ffe34c9291f2d48662efbc65bf420430ecc452671f776e55022",
      [8, 36, 17, 45],
    ],
    [
      [10, 64, 64, 14, 22, 12, 6],
      "dd560007d6e8682e0a8ee2b1dda4f5ea50d809abe05b0dcb8dc6b861eff9717f",
      [7, 46, 16, 55],
    ],
    [
      [981, 40, 32, 18, 16, 6, 2],
      "2a91d72c881ccbf8646a8d44e5689d1a18f9dfedc27b6a6bf8422c463b26fbaf",
      [22, 29, 31, 38],
    ],
  ] as const;
  for (const [
    [seed, width, height, walls, wallLength, rooms, squares],
    hash,
    exit,
  ] of cases) {
    const map = geometry(
      { width, height, walls, wallLength, rooms, squares, exit: null },
      new DosRandom(seed),
    );
    const bytes = Buffer.alloc(map.cells.length * 2);
    map.cells.forEach((v, i) => bytes.writeUInt16LE(v, i * 2));
    assert.equal(digest(bytes), hash);
    assert.deepEqual(
      [map.exit.left, map.exit.top, map.exit.right, map.exit.bottom],
      exit,
    );
    assert.equal(map.accessCount, 3);
  }
});

test("all 75 DOS maps reproduce the native ordered prop, key and mission-object traces", () => {
  const hashes = [
    "ee13b53c5d865afbf3a9383e19d853313592a93381c1148fc1408caa763720b7",
    "54b2862d2defedbb4505f20fa08258c093bc27455cda4f3d3911f164f5bd80cf",
    "093423f82163ca23426d3ee6ac3dcb53a91c98783dcc20cc888842f4be0547dc",
    "8ca43bbb7cb394cdd57bd1c385d3bdce49212e10d37df609ae67972935228248",
    "1b0a74e23697b7715fabb9885bd1415fce68b69e54f1ef7db2028a84ca1c7452",
    "153c9c5777624fe7bd33dd201a85f457413a7289f6e252c3aca4e97324fd7136",
    "a1e463c45d3b3f8f99e85e211d5279819acf8a89dde6b670815416aca61aca0d",
  ];
  const groups = [
    ...CAMPAIGNS.map((c) => c.missions),
    ...DOGFIGHTS.map((m) => [m]),
  ];
  for (const [group, missions] of groups.entries()) {
    const trace = createHash("sha256");
    for (const [mission, spec] of missions.entries()) {
      const dogfight = group >= CAMPAIGNS.length;
      const map = buildMission(
        dogfight ? group - CAMPAIGNS.length : mission,
        123,
        dogfight,
        group,
      );
      const tileFlags = (flags: number) =>
        (flags & 2 ? 1 : 0) | (flags & 4 ? 2 : 0);
      const rows = map.props.map((p) => [
        "P",
        p.pixelX,
        p.pixelY,
        PROP_DEFS[p.objectIndex]!.sprite.id,
        tileFlags(p.objectFlags),
      ]);
      for (const item of map.items) {
        if (item.kind === "hostage") continue;
        const flags = (item.objectiveIndex + 1) << 3;
        rows.push([
          item.kind === "core" ? "I" : "P",
          item.pixelX,
          item.pixelY,
          item.sprite,
          flags | (item.kind === "core" ? 4 : tileFlags(item.objectFlags)),
        ]);
      }
      for (const key of map.keys)
        rows.push([
          "I",
          key.x * 16 + 8,
          key.y * 12 + 6,
          KEY_SPRITES[spec.keyStyle]![COLORS.indexOf(key.color)]!.id,
          4,
        ]);
      trace.update(rows.map((row) => row.join(" ") + "\n").join("") + "\0");
    }
    assert.equal(trace.digest("hex"), hashes[group], group.toString());
  }
});

test("all campaigns and both dogfight arenas generate playable deterministic spawns", () => {
  for (let index = 0; index < MISSION_COUNT + DOGFIGHTS.length; index++) {
    const dogfight = index >= MISSION_COUNT,
      mission = dogfight ? index - MISSION_COUNT : index;
    const map = buildMission(mission, 29, dogfight);
    assert.equal(map.spawns.length, 6);
    assert.equal(map.tiles.length, 64);
    assert.ok(map.tiles.every((row) => row.length === 64));
    if (!dogfight)
      assert.ok(
        map.tiles.some((row) => row.includes("E")),
        getMission(mission).title,
      );
    else assert.equal(map.enemies.length, 0);
    for (const p of [...map.spawns, ...map.enemies]) {
      assert.ok([".", "E"].includes(map.tiles[p.y]![p.x]!));
      assert.equal(Math.floor(p.pixelX / 16), p.x);
      assert.equal(Math.floor(p.pixelY / 12), p.y);
    }
    for (const d of map.doors) {
      assert.equal(map.tiles[d.y]![d.x], "D");
      if (d.key) assert.ok(map.keys.some((k) => k.color === d.key));
    }
  }
  assert.deepEqual(buildMission(2, 123), buildMission(2, 123));
  const a = buildMission(0, 100),
    b = buildMission(0, 101);
  assert.deepEqual(a.tiles, b.tiles);
  assert.notDeepEqual(a.spawns, b.spawns);
  assert.deepEqual(
    buildMission(CAMPAIGNS[0]!.missions.length, 100).tiles,
    buildMission(0, 100, false, 1).tiles,
  );
});
