import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { SONGS } from "../../../scripts/lib/fusemania/songs.js";
import { FUSE_TRACKS } from "../../../packages/fuseos/src/winamp/fuseTracks.js";
import { LIBRARY } from "../src/songs.js";

// Baseline refreshed for the intentional DSP regeneration of all first-party charts.
// Normalizing only #TITLE keeps subsequent display-name edits independent of notes, timing and audio metadata.
const ORIGINAL_CHARTS: Readonly<Record<string, string>> = {
  afronova: "91e99b7b6c97d0553fda9b72ea5a8ee5f40cf68ba1a4af5909324c61d5608b6d",
  "afronova-radio-edit":
    "ad832bb4f57938d76a98a62d619a80d85d7ae06371e7b7cae7ecd64ded609aea",
  "burning-heat":
    "d85690ed337888602545d57b4fc09231054b1acc00518f991f7562cb09a520d5",
  "cant-stop-fallin-in-love":
    "8f74189d04b29f086c8c1ce0940647ceab6e8f684ac727ee361218b128846283",
  candy: "c06a77925e11181d6bc8b3f8b3d972a5f23c43bf20a1f89fa20a7c079c5cdecd",
  "electro-tuned":
    "79043c9774a7fc8fde65fdca5f8de2e4ea5cddca4910745f553980869aa4f11b",
  "exotic-ethnic":
    "2b9f52094b0b9d602405edf4f1f47b424296490a8c933798332c28c8d8ceed93",
  "paranoia-survivor-max":
    "18bdf1e4a851d1009af15f00a53eb36ba3a9505e7901f4d6b3d1fa9dfd4caa3c",
  "rain-of-sorrow":
    "4b9b446a8c045218958bddc96c29cd72356e8bc47947228af48fcf9c0b1512ed",
  "rain-of-sorrow-night-mix":
    "e618e4174f80436a8c5fc57824dd1c389d7ae28cc348ed789d7bd2f790cd5f3d",
  "the-least-100sec":
    "a32c94f17f565b08f33d134f61b79eaa02e735681893dfbbbacc8a665a05b71d",
  "the-legend-of-max":
    "793c35b92f3cc32ddcb854a21bc2507a9ee17dc7638448fd85ac9e55c3f5ac50",
  xenon: "8c64bd483e6470e1f0bc8fc295cc0fe0d4b9413aafa9daf5676633c51d49ed59",
  determinator:
    "2f03ae55ec31592bb0102fbc3aaa153419b8690a0f1dfa42f0b4d22030584e54",
  monolith: "c3ae5daf2b1bfd6298bf9c524d7fced3a5317c96c48278760bfd817cead41722",
  "temple-of-boom":
    "9415cbf1a4e67111e2360939ac566f3e9a2f1ceeeeb5d9c7b90f23b77713919d",
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
