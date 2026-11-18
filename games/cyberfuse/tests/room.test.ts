import assert from "node:assert/strict";
import test from "node:test";
import { finishRound } from "../src/game/result.js";
import { dueReports } from "../src/app/reports.js";
import { ACTION, JOIN, PRESENCE, World } from "fuse-netcode";
import {
  createRoom,
  cyberfuseGame,
  DEFAULT_SETTINGS,
  clockAt,
  RIGHT,
  LEFT,
  FIRE,
  PLAY,
  ADVANCE,
  isCyberfuseEntry,
  parseSettings,
  type CyberfuseEntry,
  type CyberfuseSettings,
} from "../src/game/index.js";

function replica(settings: CyberfuseSettings = DEFAULT_SETTINGS) {
  const room = new World(
    cyberfuseGame,
    createRoom("lobby", settings),
    "host",
    "host",
  );
  const host = room.stream("host", 1);
  room.stream("peer", 1);
  host.append(1, [JOIN, "peer", "Blue", 0, "robot", 1]);
  host.append(2, [ACTION, "start", "mission"]);
  host.through = 120;
  return room;
}
test("a late release rolls back a solo operative and the recovered snapshot continues on the same 70 Hz phase", () => {
  const timely = replica(),
    late = replica();
  const press: CyberfuseEntry = [1, 3, PLAY, "mission", 1, RIGHT | FIRE],
    release: CyberfuseEntry = [2, 7, PLAY, "mission", 1, 0];
  timely.receive("peer", [press, release], 2, 25, 25);
  timely.advance(14);
  late.receive("peer", [press], 1, 5, 5);
  late.advance(14);
  assert.notEqual(
    cyberfuseGame.hash(late.state),
    cyberfuseGame.hash(timely.state),
  );
  const corrected = late.receive("peer", [press, release], 2, 25, 25);
  assert.ok(corrected.rollbackTicks > 0);
  assert.equal(
    cyberfuseGame.hash(late.state),
    cyberfuseGame.hash(timely.state),
  );
  assert.equal(clockAt(20), 70);
  assert.equal(timely.state.world?.tick, clockAt(14) - clockAt(1));
  const fields = cyberfuseGame.checkpoint.encode(timely.state);
  const restored = cyberfuseGame.checkpoint.decode(structuredClone(fields), 14);
  assert.ok(restored);
  const next = cyberfuseGame.createTicker();
  assert.equal(cyberfuseGame.hash(restored), cyberfuseGame.hash(timely.state));
  next(restored, "host", new Map());
  timely.advance(15);
  assert.equal(cyberfuseGame.hash(restored), cyberfuseGame.hash(timely.state));
  assert.equal(
    cyberfuseGame.checkpoint.decode(
      [...fields.slice(0, 9), {}, fields[10]],
      14,
    ),
    undefined,
  );
});
test("out-of-scope controls and a retired generation cannot move the reconnected player", () => {
  const room = replica();
  room.receive(
    "peer",
    [
      [1, 3, PLAY, "other", 1, FIRE],
      [2, 4, PLAY, "mission", 2, RIGHT],
      [3, 5, PLAY, "mission", 1, LEFT],
    ],
    3,
    10,
    10,
  );
  room.advance(4);
  assert.equal(room.state.held.peer, undefined);
  room.advance(5);
  assert.deepEqual(room.state.held.peer, { bits: LEFT, generation: 1 });
  const ticker = cyberfuseGame.createTicker(),
    state = room.state;
  ticker(
    state,
    "host",
    new Map([
      ["host", { generation: 1, entries: [[3, 6, PRESENCE, "peer", true, 2]] }],
      ["peer", { generation: 1, entries: [[4, 6, PLAY, "mission", 1, FIRE]] }],
    ]),
  );
  assert.equal(state.held.peer, undefined);
});
test("one seated dogfighter receives a real AI opponent and room controls remain bounded", () => {
  const room = replica({ ...DEFAULT_SETTINGS, mode: "dogfight" });
  room.advance(2);
  assert.equal(room.state.roster.length, 2);
  assert.equal(
    room.state.world?.actors.filter((a) => a.seat !== null).length,
    2,
  );
  assert.equal(room.state.roster.filter((p) => p.bot).length, 1);
  assert.equal(
    parseSettings({ display: false, mode: "dogfight", loadout: [1, 1] }),
    undefined,
  );
  assert.equal(
    parseSettings({ display: false, mode: "campaign", loadout: [16] }),
    undefined,
  );
  assert.equal(isCyberfuseEntry([1, 1, PLAY, "m", 1, 64]), false);
  assert.equal(isCyberfuseEntry([1, 1, ADVANCE, "m", 1]), true);
});

test("dogfight plays to five and keeps each finished receipt available to confirmed participants through a rematch", () => {
  const room = replica({ ...DEFAULT_SETTINGS, mode: "dogfight" });
  room.advance(2);
  const state = room.state,
    ticker = cyberfuseGame.createTicker();
  for (let round = 1; round <= 5; round++) {
    assert.equal(state.round, round);
    state.world = { ...state.world!, outcome: "victory", winners: ["peer"] };
    finishRound(state, state.tick);
    if (round < 5) {
      assert.equal(state.stage, "between");
      ticker(
        state,
        "host",
        new Map([
          [
            "host",
            {
              generation: 1,
              entries: [
                [10 + round, state.tick + 1, ADVANCE, state.matchId, round],
              ],
            },
          ],
        ]),
      );
    }
  }
  assert.equal(state.stage, "over");
  const reports = dueReports(state, "peer", state.tick, new Set());
  assert.equal(reports.length, 6);
  assert.equal(reports.at(-1)?.result.winnerId, "peer");
  assert.equal(
    reports.at(-1)?.result.players.find((p) => p.playerId === "peer")
      ?.roundWins,
    5,
  );
  assert.equal(dueReports(state, "spectator", state.tick, new Set()).length, 0);
  assert.equal(dueReports(state, "peer", 0, new Set()).length, 0);
  ticker(
    state,
    "host",
    new Map([
      [
        "host",
        {
          generation: 1,
          entries: [[20, state.tick + 1, ACTION, "rematch", "new-match"]],
        },
      ],
    ]),
  );
  assert.equal(state.stage, "running");
  assert.equal(state.round, 1);
  assert.equal(dueReports(state, "peer", state.tick, new Set()).length, 6);
});
