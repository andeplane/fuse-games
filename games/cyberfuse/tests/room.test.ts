import assert from "node:assert/strict";
import test from "node:test";
import { finishRound } from "../src/game/result.js";
import { parseCyberfuseStats } from "../src/game/stats.js";
import { dueReports } from "../src/app/reports.js";
import {
  ACTION,
  JOIN,
  PRESENCE,
  World,
  encodeSnapshot,
  decodeSnapshot,
  SnapshotAssembler,
} from "fuse-netcode";
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
  EQUIP,
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
      [...fields.slice(0, 9), {}, ...fields.slice(10)],
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

test("a campaign password opens its source mission and the receipt only counts missions played", () => {
  const room = replica({ ...DEFAULT_SETTINGS, campaign: 1, startMission: 2 });
  room.advance(2);
  assert.equal(room.state.round, 3);
  assert.equal(room.state.world?.mission, 2);
  const snapshot = cyberfuseGame.checkpoint.encode(room.state);
  assert.ok(cyberfuseGame.checkpoint.decode(snapshot, 2));
  room.state.world = { ...room.state.world!, outcome: "defeat", winners: [] };
  finishRound(room.state, room.tick);
  const reports = dueReports(room.state, "peer", room.tick, new Set());
  assert.equal(reports[0]?.result.round, 3);
  assert.equal(reports[1]?.result.length, 1);
  assert.equal(
    parseSettings({ ...DEFAULT_SETTINGS, campaign: 1, startMission: 8e9 }),
    undefined,
  );
});

test("each operative launches with their own legal loadout; campaign changes invalidate stale armory entries", () => {
  const room = createRoom("lobby", DEFAULT_SETTINGS);
  const tick = cyberfuseGame.createTicker();
  tick(
    room,
    "a",
    new Map([
      [
        "a",
        {
          generation: 1,
          entries: [
            [1, 1, JOIN, "a", "Ana", 0, "robot", 1],
            [2, 1, JOIN, "b", "Bo", 1, "robot", 2],
          ],
        },
      ],
    ]),
  );
  const key = room.armoryKey;
  tick(
    room,
    "a",
    new Map([
      ["a", { generation: 1, entries: [[3, 2, EQUIP, "lobby", 0, key, [1]]] }],
      ["b", { generation: 2, entries: [[1, 2, EQUIP, "lobby", 0, key, [4]]] }],
    ]),
  );
  assert.deepEqual(room.loadouts, { a: [1], b: [4] });
  assert.ok(
    cyberfuseGame.checkpoint.decode(cyberfuseGame.checkpoint.encode(room), 2),
  );
  const start = structuredClone(room);
  tick(
    start,
    "a",
    new Map([
      ["a", { generation: 1, entries: [[4, 3, ACTION, "start", "equipped"]] }],
    ]),
  );
  assert.deepEqual(
    start.world?.actors.filter((p) => p.seat !== null).map((p) => p.inventory),
    [[1], [4]],
  );
  tick(
    room,
    "a",
    new Map([
      [
        "a",
        {
          generation: 1,
          entries: [[4, 3, 13, { ...DEFAULT_SETTINGS, campaign: 1 }]],
        },
      ],
    ]),
  );
  assert.deepEqual(room.loadouts, {});
  tick(
    room,
    "a",
    new Map([
      ["a", { generation: 1, entries: [[5, 4, EQUIP, "lobby", 0, key, [1]]] }],
    ]),
  );
  assert.deepEqual(room.loadouts, {});
});

test("a joining peer installs the running mission from a retried snapshot and continues on the host clock", () => {
  const source = replica();
  source.receive("peer", [[1, 3, PLAY, "mission", 1, FIRE]], 1, 60, 60);
  source.advance(40);
  const snapshot = encodeSnapshot(source, 4);
  const assembler = new SnapshotAssembler(cyberfuseGame, 4);
  let complete: { tick: number; bytes: Uint8Array } | undefined;
  assert.ok(snapshot.length > 1);
  assert.equal(assembler.accept(snapshot[1]!), undefined);
  for (const chunk of snapshot) complete = assembler.accept(chunk);
  assert.ok(complete);
  const decoded = decodeSnapshot(cyberfuseGame, complete.bytes, 4);
  assert.ok(decoded);
  const resumed = new World(cyberfuseGame, decoded.state, "host", "peer");
  const sourceState = structuredClone(source.servable().state);
  const tick = cyberfuseGame.createTicker();
  for (let i = 0; i < 8; i++) {
    tick(sourceState, "host", new Map());
    tick(resumed.state, "host", new Map());
  }
  assert.equal(
    cyberfuseGame.hash(sourceState),
    cyberfuseGame.hash(resumed.state),
  );
  assert.equal(decodeSnapshot(cyberfuseGame, complete.bytes, 5), undefined);
});

test("confirmed campaign scores carry DOS performance bonuses and reset a revived player's score at the next mission", () => {
  const room = replica();
  room.advance(2);
  const state = room.state;
  const world = state.world!;
  state.world = {
    ...world,
    outcome: "victory",
    winners: ["peer"],
    actors: world.actors.map((actor) =>
      actor.seat === "peer" ? { ...actor, score: 90, hp: 0 } : actor,
    ),
  };
  finishRound(state, state.tick);
  const captured = state.history[0]!.result.players[0]!;
  assert.equal(captured.score, 90);
  assert.equal(captured.survived, false);
  assert.equal(captured.bonus, 0);
  assert.deepEqual(parseCyberfuseStats(captured, 1), captured);
  cyberfuseGame.createTicker()(
    state,
    "host",
    new Map([
      [
        "host",
        {
          generation: 1,
          entries: [[3, state.tick + 1, ADVANCE, "mission", 1]],
        },
      ],
    ]),
  );
  assert.equal(cyberfuseGame.view(state).results[0]!.score, 0);
  state.world = { ...state.world!, outcome: "victory", winners: ["peer"] };
  finishRound(state, state.tick);
  const next = state.history[1]!.result.players[0]!;
  assert.ok(next.bonus > 0);
  assert.equal(cyberfuseGame.view(state).results[0]!.score, next.score);
  assert.equal(
    parseCyberfuseStats({ ...next, matchScoreUnits: -1 }, 1),
    undefined,
  );
});
