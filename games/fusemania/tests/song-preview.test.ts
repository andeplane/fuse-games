import test from "node:test";
import assert from "node:assert/strict";
import { LIBRARY } from "../src/songs.js";
import { previewSong } from "../src/app/song-preview.js";

test("DukAmok external songs are available to the carousel preview", () => {
  const song = previewSong(LIBRARY, "dukamok-animate-inanimate");
  assert.ok(song);
  assert.match(song.audio, /^https:\/\/storage.googleapis.com\/.+\.ogg$/);
  assert.ok(previewSong(LIBRARY, "pixel-sax-parade"));
  assert.equal(previewSong(LIBRARY, "missing"), undefined);
  for (const audio of [
    "blob:https://play.example/local",
    "data:audio/ogg;base64,AA==",
  ]) {
    assert.equal(
      previewSong({ song: () => ({ ...song, audio }) }, "local"),
      undefined,
    );
  }
});
