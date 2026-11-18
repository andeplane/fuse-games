import { test } from "node:test";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import {
  OFFROAD_COURSE_NAMES,
  getOffroadCourse,
  nativeRegionContains,
  nativeRegionProgress,
  projectOffroad,
  unprojectOffroad,
} from "../src/game/offroad/course.js";

test("original 8086 lap-position readings for every inside and surrounding grid cell", () => {
  const values = [];
  for (const name of OFFROAD_COURSE_NAMES) {
    for (const r of getOffroadCourse(name).regions) {
      for (let x = r.left - 1; x <= r.right; x++) {
        for (let y = r.top - 1; y <= r.bottom + 1; y++) {
          values.push((nativeRegionProgress(r, x * 256, y * 256) ?? -1) + 1);
        }
      }
    }
  }
  assert.equal(values.length, 50072);
  // GAME.EXE file 0x23dc, run under Unicorn 2.1.4. Zero encodes carry set.
  assert.equal(
    createHash("sha256").update(Uint8Array.from(values)).digest("hex"),
    "1dfb2c878e14cb74b4f687947d5f8dcb38a7286dab75502a7e6f892e3af0b362",
  );
});

test("every grid seat, including the fifth Fuse seat, has four unobstructed wheels", () => {
  assert.equal(OFFROAD_COURSE_NAMES.length, 16);
  for (const name of OFFROAD_COURSE_NAMES) {
    const course = getOffroadCourse(name);
    assert.equal(course.spawns.length, 5);
    assert.equal(new Set(course.spawns.map((p) => `${p.x},${p.y}`)).size, 5);
    for (const p of course.spawns) {
      for (const dx of [-181, 181])
        for (const dy of [-181, 181])
          assert.equal(
            course.terrain.sample(p.x + dx, p.y + dy)?.blocked,
            false,
            name,
          );
      const projected = projectOffroad(name, p.x, p.y, p.height);
      const inverted = unprojectOffroad(name, projected, p.height);
      assert.ok(
        Math.abs(inverted.x - p.x) < 1e-8 && Math.abs(inverted.y - p.y) < 1e-8,
      );
    }
  }
});

test("native direction programs cross every lap region in sequence in both directions", () => {
  for (const name of OFFROAD_COURSE_NAMES) {
    const { regions, waypoints } = getOffroadCourse(name);
    let goal = 0,
      laps = 0;
    for (let i = 0; i < 2 * waypoints.length; i++) {
      const a = waypoints[i % waypoints.length]!,
        b = waypoints[(i + 1) % waypoints.length]!;
      const steps = Math.ceil(Math.hypot(a.x - b.x, a.y - b.y) / 32);
      for (let s = 1; s <= steps; s++) {
        if (
          nativeRegionContains(
            regions[goal]!,
            a.x + ((b.x - a.x) * s) / steps,
            a.y + ((b.y - a.y) * s) / steps,
          )
        ) {
          goal++;
          if (goal === regions.length) {
            laps++;
            goal = 0;
          }
        }
      }
    }
    assert.ok(laps >= 1, `${name} missed goal ${goal}`);
  }
});

test("continuous projection lies within DOS screen-pixel truncation at the starting stripe", () => {
  const p = getOffroadCourse("offroad-1").spawns[3]!;
  // Original function at game.exe file 0x1a5f returns DOS pixel (67,114) for this truck.
  const world = projectOffroad("offroad-1", p.x, p.y, p.height);
  assert.equal(Math.floor(world.x / 3.2), 67);
  assert.equal(Math.floor(world.y / 2.56), 114);
});
