import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryStorage } from "fuse-ui/safe-storage";
import type { RankObservation } from "../src/app/ranked-run.js";
import { createRoomScores } from "../src/app/room-scores.js";
import { game, run, started } from "./fixtures/room.js";

test("room scores write the confirmed best once and keep showing the old best through rollbacks", () => {
  const store = createMemoryStorage();
  store.setItem("best", "700000");
  const ranked: RankObservation[] = [];
  const finished: number[] = [];
  let confirmed = false;
  const observe = createRoomScores({
    store,
    viewer: { me: "a", host: true, solo: false, display: false },
    bundledLibrary: true,
    bestKey: () => "best",
    progress: () => ({ epoch: 2, confirmed }),
    observeRanked: (value) => ranked.push(value),
    songFinished: ({ rating }) => finished.push(rating),
  });
  const room = started();
  assert.equal(observe(game.view(room), "online"), undefined);
  assert.equal(ranked.at(-1)?.key, "m1:2");
  assert.equal(ranked.at(-1)?.beforeSong, true);

  run(room, 900);
  const final = game.view(room);
  assert.equal(final.stage, "over");
  assert.ok(final.world);
  const player = final.world.players.find((each) => each.id === "a");
  assert.ok(player);
  player.rating = 850_000;
  assert.equal(observe(final, "online"), 700_000);
  assert.equal(ranked.at(-1)?.confirmed, false);
  assert.equal(store.getItem("best"), "700000");

  player.rating = 900_000;
  confirmed = true;
  assert.equal(observe(final, "online"), 700_000);
  assert.equal(observe(final, "online"), 700_000);
  assert.equal(ranked.at(-1)?.confirmed, true);
  assert.equal(store.getItem("best"), "900000");
  assert.deepEqual(finished, [850_000]);
});
