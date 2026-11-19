import test from "node:test";
import { parseDocksideStats, validDocksideField } from "../src/platform.js";
import assert from "node:assert/strict";
import { ACTION, BOT, JOIN, World as Replica } from "fuse-netcode";
import {
  createRoom,
  docksideGame,
  DEFAULT_SETTINGS,
  PLAY,
  encode,
  decode,
  hash,
  KEY,
  INPUT_MASK,
  stepWorld,
  botInput,
  view,
  type Entry,
} from "../src/game/index.js";
import { matchResult, roundResult } from "../src/game/result.js";
import { dueReports, decisionConfirmed } from "../src/app/reports.js";
const host = "a",
  pilot = "b";
function room() {
  const replica = new Replica(
    docksideGame,
    createRoom("lobby", DEFAULT_SETTINGS),
    host,
    host,
  );
  const log = replica.stream(host, 1);
  replica.stream(pilot, 1);
  log.append(1, [JOIN, pilot, "Pilot", 0, "robot", 1]);
  log.append(1, [BOT, "add", "bot:1", "Crane", 1]);
  log.append(2, [ACTION, "start", "canal"]);
  log.through = 700;
  return replica;
}
test("late held movement, its release and a stale match command converge through real rollback", () => {
  const whole = room(),
    delayed = room();
  const entries: Entry[] = [
    [1, 5, PLAY, "canal", KEY.up | KEY.fire | KEY.missile | KEY.special],
    [2, 17, PLAY, "canal", 0],
    [3, 23, PLAY, "previous", KEY.left],
  ];
  whole.receive(pilot, entries, 3, 80, 80);
  whole.advance(80);
  delayed.receive(pilot, [entries[0]!], 1, 8, 8);
  delayed.advance(32);
  const corrected = delayed.receive(pilot, entries, 3, 80, 80);
  assert.ok(corrected.rollbackTicks > 0);
  delayed.advance(80);
  assert.equal(hash(whole.state), hash(delayed.state));
  assert.equal(whole.state.world!.rigs[0]!.x, -2400);
  assert.deepEqual(
    whole.state.world!.rigs[0]!.shots.map((s) => s.tick > 0),
    [true, true, true],
  );
  const cp = encode(whole.state);
  assert.equal(hash(decode(cp, 80)!), hash(whole.state));
  assert.equal(decode(cp, 79), undefined);
  const corrupt = structuredClone(cp);
  corrupt[8] = {};
  assert.equal(decode(corrupt, 80), undefined);
  assert.equal(
    docksideGame.isEntry([1, 5, PLAY, "canal", INPUT_MASK + 1]),
    false,
  );
});
test("confirmed delivery produces a match and one round receipt only for a participating pilot", () => {
  const r = room();
  r.receive(pilot, [], 0, 1000, 1000);
  r.advance(30);
  const w = r.state.world!;
  while (!w.winners.length && w.tick < 3000) stepWorld(w, [0, botInput(w, 1)]);
  assert.deepEqual(w.winners, [1]);
  docksideGame.createTicker()(r.state, host, new Map());
  assert.equal(matchResult(r.state)?.winnerId, "bot:1");
  assert.equal(roundResult(r.state)?.round, 1);
  const confirmed = r.state.decided!.clock;
  assert.equal(dueReports(r.state, pilot, confirmed - 1, new Set()).length, 0);
  const due = dueReports(r.state, pilot, confirmed, new Set());
  assert.equal(due.length, 2);
  assert.equal(dueReports(r.state, "watcher", confirmed, new Set()).length, 0);
  assert.equal(
    dueReports(r.state, pilot, confirmed, new Set(due.map((d) => d.key)))
      .length,
    0,
  );
});

test("releases and presses in one tick preserve distinct transform and factory edges", () => {
  const r = room();
  const entries: Entry[] = [
    [1, 3, PLAY, "canal", KEY.shift],
    [2, 3, PLAY, "canal", 0],
    [3, 4, PLAY, "canal", KEY.shift],
    [4, 5, PLAY, "canal", 0],
    [5, 5, PLAY, "canal", KEY.shift],
  ];
  r.receive(pilot, entries, 5, 5, 5);
  r.advance(3);
  assert.equal(r.state.world!.rigs[0]!.travel, true);
  assert.equal(r.state.world!.rigs[0]!.previous, 0);
  r.advance(4);
  assert.equal(r.state.world!.rigs[0]!.travel, false);
  r.advance(5);
  assert.equal(r.state.world!.rigs[0]!.travel, true);
  const factoryEntries: Entry[] = [
    [6, 6, PLAY, "canal", KEY.jinkLeft],
    [7, 14, PLAY, "canal", 0],
    [8, 604, PLAY, "canal", KEY.launch],
    [9, 604, PLAY, "canal", 0],
    [10, 605, PLAY, "canal", KEY.launch],
  ];
  r.receive(pilot, factoryEntries, 10, 650, 650);
  r.advance(605);
  assert.equal(r.state.world!.rigs[0]!.launched, 2);
  assert.equal(r.state.world!.drones.filter((d) => d.team === 0).length, 2);
});
test("the confirmed finish remains reportable as the predicted room enters its rematch", () => {
  const r = room();
  r.receive(pilot, [], 0, 1000, 1000);
  r.advance(30);
  const predicted = r.state,
    w = predicted.world!;
  const earlier = view(predicted);
  while (!w.winners.length && w.tick < 3000) stepWorld(w, [0, botInput(w, 1)]);
  docksideGame.createTicker()(predicted, host, new Map());
  const confirmed = view(predicted);
  assert.equal(decisionConfirmed(predicted, earlier), false);
  assert.equal(decisionConfirmed(predicted, confirmed), true);
  const next = createRoom("new-match", DEFAULT_SETTINGS);
  assert.equal(decisionConfirmed(next, confirmed), false);
  assert.equal(
    dueReports(confirmed, pilot, confirmed.tick, new Set()).length,
    2,
  );
});

test("platform validates the actual dispatches that could produce a delivery or interception", () => {
  const win = {
    playerId: "a".repeat(24),
    name: "West",
    slot: 0,
    roundsPlayed: 1,
    roundWins: 1,
    matchScoreUnits: 1,
    matchPlacement: 1,
    earlyExits: 0,
    points: 1,
    launched: 2,
    intercepted: 0,
  };
  const lose = {
    ...win,
    playerId: "b".repeat(24),
    name: "East",
    slot: 1,
    roundWins: 0,
    matchScoreUnits: 0,
    matchPlacement: 2,
    points: 0,
    launched: 0,
    intercepted: 1,
  };
  assert.ok(parseDocksideStats(win, 1));
  assert.equal(parseDocksideStats({ ...win, launched: 0 }, 1), undefined);
  assert.ok(validDocksideField([win, lose]));
  assert.equal(validDocksideField([win, { ...lose, intercepted: 2 }]), false);
});
