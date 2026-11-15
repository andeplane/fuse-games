import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { SONGS } from "../../../scripts/lib/fusemania/songs.js";
import { FUSE_TRACKS } from "../../../packages/fuseos/src/winamp/fuseTracks.js";
import { LIBRARY } from "../src/songs.js";

// Before the display-name change, with only #TITLE normalized. Holds chart notes, timing, audio reference and
// all other simfile metadata to the original authored files while allowing their display titles to change.
const ORIGINAL_CHARTS: Readonly<Record<string, string>> = {
  afronova: "1fe0d03e1650a504d31d27741e41a1c3a7ca17d3e6967add4f0bf8f1cea120ed",
  "afronova-radio-edit":
    "58adb0dbd3dd5cca85d2cb04e6de459fda7767ec4931ad2892bbfb83f32e544c",
  "burning-heat":
    "93a2af8363ba2eccd1888ff53cdacc7aee061134a29dd56f9da0105237aa6565",
  "cant-stop-fallin-in-love":
    "1be8e4976687ba8455a3f3c2508c83bce924eb2e1ba3ef1b180662fae749f1fc",
  candy: "e0745aa8700a0f558884560290f1d9804c169cf745c03603ca41ef3bfdfa7c16",
  "electro-tuned":
    "d49bd988d11c69e3405fe0d483e5036d18b4eeece40493a12b736f702226a8c5",
  "exotic-ethnic":
    "d956fbef015f6d6afb3a9e7297539b76e378b2cdc8c6fb20113d27d262f21e48",
  "paranoia-survivor-max":
    "17f87c812fc69e2cd19df0e0c4e49a39d5f3536c193f2c02479c06ca5aaad1e7",
  "rain-of-sorrow":
    "270615447945f12aab8f14cb4c1c73bb749d32c7ef4d9d6d5acee2c668e01991",
  "rain-of-sorrow-night-mix":
    "97de66c41db7e677a5a9f0ecbd5c8b8be0ea0154eafd843e0e439914aee3bcb6",
  "the-least-100sec":
    "b76cf933bbc6860ddb568ca4b3dc374a2a4b72350f86c1b47d16a7c75e255d43",
  "the-legend-of-max":
    "44d7b1ddf7743c69580837e75b029f2f0b4a05f7925b4e4f4a438851146b0dbf",
  xenon: "3f92b9390f2c895b2c3f6d14c32a3c504e0a1b87217a124229d8cb8f8929bbd0",
  determinator:
    "82d17cc7b108d2cc55749c208e1a9d7a784a0e22bb1be5f6ae20cc7e445a7c96",
  monolith: "e9321a41c9dc3f4dc1a30d039935e44080a925f47033cfdf023f8395cdff494b",
  "temple-of-boom":
    "c556e9c6e59026cc4c325f186917fa1248b2c1ca128c230d995b34530a932ed4",
};
const mixes = SONGS.filter((song) =>
  ["ddr-jazz-mix", "itg-jazz-mix"].includes(song.pack),
);
const root = fileURLToPath(new URL("../../../", import.meta.url));

test("every jazz cover has a distinct jazz-mix display name across the game and Winamp", () => {
  assert.deepEqual(
    mixes.map((song) => song.id).sort(),
    Object.keys(ORIGINAL_CHARTS).sort(),
  );
  const mixNames = new Set<string>();
  for (const song of mixes) {
    const suffix = song.title.match(/\((.+ Jazz Mix)\)$/)?.[1];
    assert.ok(suffix, `${song.id}: a named Jazz Mix`);
    assert.ok(!mixNames.has(suffix), `${song.id}: distinct jazz wording`);
    mixNames.add(suffix);
    assert.equal(LIBRARY.song(song.id)?.title, song.title);
    assert.equal(
      FUSE_TRACKS.find((track) => track.path === song.audio)?.title,
      song.title,
    );
    assert.equal(
      song.audio,
      `music/${song.pack}/${song.id}.mp3`,
      `${song.id}: stable audio address`,
    );
  }
});

test("renaming the jazz mixes changes no notes, timing or other chart metadata", () => {
  for (const song of mixes) {
    const chart = readFileSync(
      `${root}games/fusemania/charts/${song.id}.ssc`,
      "utf8",
    );
    assert.equal(
      createHash("sha256")
        .update(chart.replace(/^#TITLE:[^\n]*$/m, "#TITLE:;"))
        .digest("hex"),
      ORIGINAL_CHARTS[song.id],
      song.id,
    );
  }
});
