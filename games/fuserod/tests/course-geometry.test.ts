import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { nativeCourseSample } from "../src/course/geometry.js";
import { channelStep, courseFeatures } from "../src/course/index.js";

// Fingerprints of native heading, height, forward differences and geometric
// flags, packed as five little-endian signed words per playable segment.
const canyon = [
  "ab82bfe3c655aaef3fe8f5d1290babe8fb1715e258aa2cd2c1b743557110feb9",
  "511a7020f4db65b764f91c0cedfbba650d049a50e47c1966ed7528438bf2a66d",
  "4f85bf4c2035722028dfcf3a70604f3d66e10c2df19f8cbaebf5d609b8d3a031",
  "604c2003eb251f4a7562c81e08ad0df9512dc618caa9a41ce4a1160f1bb84ef1",
  "e25e5639551036038d6b4a7ca22785ec89cd4f15469c1411c185e601aef8bdf8",
  "2a2a21749862cd9f0a1800766045b13cf0d06bee324365eafb5d138c5c9fe223",
  "0bd83d1fedf60cf4f451d303fd3f4ed2a3e47de2885f5a76ba1af4eecada8409",
  "f1542eac29e9b230b80a23199d0abbbf90438c83092731a95f5c1f1a0af83599",
  "35bc738a25f611dd875e9f972c751a3bf204e1e04b8d91c264d63906b1e32910",
  "6f5402021bf817e921333a41e46dc5d5e1ff1a6ec5a5596c4131a9443ccc361c",
];
function profile(route: "canyon" | "aqueduct", layout: number, last: number) {
  const hash = createHash("sha256");
  for (let segment = 0; segment <= last; segment++) {
    const { heading, height, bend, grade, flags } = nativeCourseSample(
      route,
      segment * 64,
      layout,
    );
    const row = Buffer.alloc(10);
    [heading, height, bend, grade, flags].forEach((v, i) =>
      row.writeInt16LE(v, 2 * i),
    );
    hash.update(row);
  }
  return hash.digest("hex");
}
test("all ten Mulholland layouts reproduce the DOS builder on every race segment", () => {
  assert.deepEqual(
    canyon.map((_, i) => profile("canyon", i, 590)),
    canyon,
  );
});
test("all aqueduct flags match the DOS builder from launch to finish", () => {
  assert.equal(
    profile("aqueduct", 0, 334),
    "1740cacf05dcdb4cb4f681968ff50b8a8a7da842c0b9b760b5c406986b77c17c",
  );
  assert.deepEqual(channelStep(0, 300, 60, false), {
    x: 300,
    speed: 60,
    roll: 0,
  });
  assert.equal(channelStep(-900, -900, 60, false).speed, 60);
});
test("canyon bank relief and right-drop guardrails follow the native constructor", () => {
  const banks = [
    "3c1ceb02669b2fec3cd7dfc3c8ae6caaa4f7c054c3439021ca438210a1834197",
    "a7496bd022169a6db4e6bff4b70c9a9533e20d059bd15c9071f1fc1a879b6973",
    "3c1ceb02669b2fec3cd7dfc3c8ae6caaa4f7c054c3439021ca438210a1834197",
    "13a67821fd6d204995c65de5d8af1e95f69288da9cfbf88c5d7ca16f4eebb142",
    "dac72b906b05ec4708d008bc8526732cfa1c048a178598bb9e7e10a4c9ea2b25",
    "5850c06d2d689702a2b86da5bd5e31358dc9c14a824bba01b775836aede0d5b2",
    "f68c5d5ecae354a287745606b33e1d99addf5925b1d58c81bef2b85e36f84441",
    "20b2eb4cfc564c5284817f6f542c85a639ff673ecd4a7d66e95a4e5262ff43c8",
    "5ac42a2a94a6010c14abc5cfd193fe25b0904173cc8c6950c36c5f719d46aaf7",
    "5b44de786976023f4acc93b137e5600506e2f1996bde28a39916417c8288e79b",
  ];
  for (let layout = 0; layout < 10; layout++) {
    const hash = createHash("sha256");
    for (let s = 0; s <= 590; s++) {
      const { leftBank, rightBank, guardrail } = nativeCourseSample(
        "canyon",
        s * 64,
        layout,
      );
      const row = Buffer.alloc(6);
      [leftBank, rightBank, Number(guardrail)].forEach((v, i) =>
        row.writeInt16LE(v, 2 * i),
      );
      hash.update(row);
    }
    assert.equal(hash.digest("hex"), banks[layout], String(layout));
  }
});
test("published bridge and rough-surface spans follow each layout", () => {
  for (let layout = 0; layout < 10; layout++)
    for (let s = 0; s < 590; s++) {
      const metre = ((s + 0.5) * 402.336) / 80;
      const flag = nativeCourseSample("canyon", s * 64, layout).flags;
      const feature = courseFeatures("canyon", layout).find(
        (f) => f.start <= metre && metre < f.end,
      );
      assert.equal(feature?.kind === "bridge", Boolean(flag & 0x80));
      assert.equal(feature?.kind === "rough", Boolean(flag & 0x60));
    }
});
