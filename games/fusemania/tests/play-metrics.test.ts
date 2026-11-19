import test from "node:test";
import assert from "node:assert/strict";
import { ACTION } from "fuse-netcode";
import { createPlayMetrics, observeConfirmedPlay } from "fuse-ui/play-metrics";
import { fusemaniaPlayFrame } from "../src/app/play-metrics.js";
import { READY, type View } from "../src/online/game.js";
import { SETTINGS, fold, game, readyGuests, seated } from "./fixtures/room.js";

test("a real three-song playlist emits three rounds and one match across intermissions", () => {
  const room = seated({ ...SETTINGS, songs: 3 });
  const events: string[] = [];
  const observe = createPlayMetrics(
    (event) => {
      events.push(event);
    },
    () => room.tick * 20,
  );
  const viewer = { self: "a", mode: "online" };
  const record = () => {
    const frame = game.view(room);
    observeConfirmedPlay(
      observe,
      frame,
      () => frame,
      (view) => fusemaniaPlayFrame(view, viewer),
    );
    // Repeated render frames cannot manufacture extra starts or completions.
    observeConfirmedPlay(
      observe,
      frame,
      () => frame,
      (view) => fusemaniaPlayFrame(view, viewer),
    );
  };
  record();
  assert.deepEqual(events, ["Seat Taken"]);
  for (let song = 1; song <= 3; song++) {
    readyGuests(room);
    fold(room, {
      a: [
        [ACTION, "start", `song-${song}`],
        [READY, song],
      ],
      b: [[READY, song]],
    });
    record();
    const countdown = fusemaniaPlayFrame(game.view(room), viewer);
    assert.equal(countdown.matchId, "song-1");
    assert.equal(countdown.round, song);
    assert.equal(countdown.active, false);
    assert.equal(countdown.roundActive, false);
    assert.equal(
      events.filter((event) => event === "Round Started").length,
      song - 1,
    );
    while (room.stage === "running") {
      fold(room);
      record();
    }
    const completed = fusemaniaPlayFrame(game.view(room), viewer);
    assert.equal(completed.round, song);
    assert.equal(completed.roundEnded, true);
    assert.equal(completed.ended, song === 3);
    if (song < 3) {
      fold(room, { a: [[ACTION, "lobby", `between-${song}`]] });
      record();
      assert.equal(
        fusemaniaPlayFrame(game.view(room), viewer).matchId,
        "song-1",
      );
      assert.equal(events.filter((event) => event === "Match Ended").length, 0);
    }
  }
  assert.equal(events.filter((event) => event === "Match Started").length, 1);
  assert.equal(events.filter((event) => event === "Match Ended").length, 1);
  assert.equal(events.filter((event) => event === "Round Started").length, 3);
  assert.equal(events.filter((event) => event === "Round Ended").length, 3);
});

test("single songs retain a single round; spectator and display views never count participation", () => {
  const room = seated();
  const events: string[] = [];
  const observe = createPlayMetrics(
    (event) => {
      events.push(event);
    },
    () => room.tick,
  );
  readyGuests(room);
  fold(room, {
    a: [
      [ACTION, "start", "single"],
      [READY, 1],
    ],
    b: [[READY, 1]],
  });
  while (room.stage === "running") {
    fold(room);
    const frame = game.view(room);
    observeConfirmedPlay(
      observe,
      frame,
      () => frame,
      (view) => fusemaniaPlayFrame(view, { self: "a", mode: "solo" }),
    );
    for (const self of ["", "watcher"]) {
      assert.equal(
        fusemaniaPlayFrame(frame, { self, mode: "shared" }).seated,
        false,
      );
    }
  }
  assert.equal(events.filter((event) => event === "Match Started").length, 1);
  assert.equal(events.filter((event) => event === "Match Ended").length, 1);
  assert.equal(events.filter((event) => event === "Round Started").length, 1);
  assert.equal(events.filter((event) => event === "Round Ended").length, 1);
});

test("round completion waits for a confirmed final view and keeps its own song number", () => {
  const room = seated({ ...SETTINGS, songs: 3 });
  const events: string[] = [];
  const observe = createPlayMetrics(
    (event) => {
      events.push(event);
    },
    () => room.tick,
  );
  const project = (frame: View) =>
    fusemaniaPlayFrame(frame, { self: "a", mode: "online" });
  readyGuests(room);
  fold(room, {
    a: [
      [ACTION, "start", "playlist"],
      [READY, 1],
    ],
    b: [[READY, 1]],
  });
  let previous = game.view(room);
  while (room.stage === "running") {
    previous = game.view(room);
    fold(room);
    observeConfirmedPlay(observe, game.view(room), () => previous, project);
  }
  assert.equal(events.filter((event) => event === "Round Ended").length, 0);
  const final = game.view(room);
  fold(room, {
    a: [
      [ACTION, "rematch", "second"],
      [READY, 2],
    ],
    b: [[READY, 2]],
  });
  observeConfirmedPlay(observe, game.view(room), () => final, project);
  assert.equal(events.filter((event) => event === "Round Ended").length, 1);
  assert.equal(events.filter((event) => event === "Match Ended").length, 0);
  assert.equal(project(final).round, 1);
  assert.equal(project(game.view(room)).round, 2);
});
