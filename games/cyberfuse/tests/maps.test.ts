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

test("each BEM mission reproduces the C reference's ordered props, keys and mission object coordinates", () => {
  const hashes = [
    "fa0c8a99f0427838b1e79a8ef58c7773feb1eebf07e1fdda5674ac5cf010d3c9",
    "296126d744951a3e78ada72e154ab026f0e15b285a1eb9452402d6f220df8d40",
    "f81ef53a46580c51bdaf6207ebf22c91fd71e3720851c3bb0657a58353743e33",
    "ee2665c16bd315409b0665eb468f66c64d3de34e6d6c3de2653d863e0d02e759",
    "ed2562944ead471a99d2ebe5724d6aeca8c0b08bdbb23a1a9f56a6d8baeef80b",
    "8ffd00ee43514e3c8983aa273a573aaf30075893f0009a68ee1e77f4b2c3d9a4",
    "7ec45ae8be5632e1c64b88d2a04463fca72f6ee873fce6fcea51f49d8122231e",
    "89fd95ab1fd7d977c0d5db6e8284614bbe1e0bb32ae3d8413001f72c45357dcf",
    "fa32e2bbab312e36af0363a1b5af662583108cb5f95ed99e4a973974840f7b67",
  ];
  for (const [mission, hash] of hashes.entries()) {
    const spec = getMission(mission),
      map = buildMission(mission, 123);
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
    assert.equal(
      digest(rows.map((row) => row.join(" ") + "\n").join("")),
      hash,
      "BEM mission " + (mission + 1),
    );
  }
});

test("all campaigns and both dogfight arenas generate playable deterministic spawns", () => {
  for (let index = 0; index < MISSION_COUNT + DOGFIGHTS.length; index++) {
    const dogfight = index >= MISSION_COUNT,
      mission = dogfight ? index - MISSION_COUNT : index;
    const map = buildMission(mission, 29, dogfight);
    assert.equal(map.spawns.length, 5);
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
