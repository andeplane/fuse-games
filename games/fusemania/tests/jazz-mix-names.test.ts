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
  afronova: "4a3d91a2e72eb3c300745099edff772e75bf834d04985aa3a6a79e85d6a5ab02",
  "afronova-radio-edit":
    "dd7f7407c29f4f08d91acce3306154940f9213c280d4a1ada0854a28afe39080",
  "burning-heat":
    "fbfbd53223cc23b3655a29b30eef1fc3fbadf74123e34141602ed568c8fa038e",
  "cant-stop-fallin-in-love":
    "6dbd7606cba4f823ed957538e522618d8a3901a91773cddaede03c74c7e87f05",
  candy: "27ed8075b860dd0ffca87755c7fc6079112c2737cc5bae395eb57b865e7f00fd",
  "electro-tuned":
    "05af632376f231902586649bc925e7a7cc375db29af3a37d6e01c1100a8e8546",
  "exotic-ethnic":
    "fcdc84bd7ed97c0bc0f8c311fe55815a8eb5ee0049e68d334cb69850f21b4125",
  "paranoia-survivor-max":
    "a2eef7f862688d24e4de362a517fd02aa67c688060156f86f22e8f321a407803",
  "rain-of-sorrow":
    "8954d86ab68afcc899a5918604c29b418a96f9038e7837917ee0015f72a84f0d",
  "rain-of-sorrow-night-mix":
    "ac730f99a9fc09fb2451da0c59ca94624c83c427a0e441740545ce9587f7ba42",
  "the-least-100sec":
    "3d0b5c35761d65b6c2c8b1c51ec052e9a4a9f6ecdde9bbc3e708b8c3e2c349ac",
  "the-legend-of-max":
    "e62bf4cf1c685024a3bc0a0d307e436e8efede91b4cc02207fcbfca08bdce054",
  xenon: "ccfc7d03afe706f58aaea11e714e7eb2d05638e712e1d2eceeace4781fc0dfa1",
  determinator:
    "e8e90bd979059c7b7b5a3c6ea0cc708d17cdc077f76fcd83aac318fbd1756e25",
  monolith: "2e19cfcd92d22cd12a2eb3b73e3fe6fe5819658d8a710029bb9ef302dc310235",
  "temple-of-boom":
    "e34e35d204053e5c4b451f0e924321e88c6ade15830d607027c55778714125e2",
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
