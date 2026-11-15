import test from "node:test";
import assert from "node:assert/strict";
import { ALL_SONGS } from "../packages/fuse-music/src/index.js";
import { FUSE_TRACKS } from "../packages/fuseos/src/winamp/fuseTracks.js";
import { SONGS } from "../scripts/lib/fusemania/songs.js";

// Fusemania's jazz-mix covers are Fusemania songs, and FuseOS plays them; the radio other games use never does.
const fusemaniaOnly = SONGS.filter((song) => song.pack !== "fusemania");
const covers = fusemaniaOnly.filter((song) =>
  ["ddr-jazz-mix", "itg-jazz-mix"].includes(song.pack),
);

test("Fusemania's covers are never radio music", () => {
  assert.ok(covers.length > 0, "no Fusemania covers found");
  const radio = new Set<string>(ALL_SONGS.map((song) => song.path));
  for (const song of fusemaniaOnly)
    assert.ok(
      !radio.has(
        song.audio.startsWith("https:") ? song.audio : `/${song.audio}`,
      ),
      `${song.id} is in the radio`,
    );
  for (const song of ALL_SONGS)
    assert.ok(
      !fusemaniaOnly.some(
        (cover) =>
          song.path === cover.audio || song.path.endsWith(`/${cover.audio}`),
      ),
      `${song.path} is a Fusemania cover in the radio`,
    );
});

test("FuseOS lists every Fusemania jazz cover, credited to Fusemania alone", () => {
  for (const song of covers) {
    const track = FUSE_TRACKS.find((each) => each.path === song.audio);
    assert.ok(track, `${song.id} is missing from FuseOS`);
    assert.deepEqual(track.games, ["fusemania"], song.id);
  }
});
