import test from "node:test";
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
  stepWorld,
  botInput,
  type Entry,
} from "../src/game/index.js";
import { matchResult, roundResult } from "../src/game/result.js";
import { dueReports } from "../src/app/reports.js";
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
    [1, 5, PLAY, "canal", KEY.right],
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
  const cp = encode(whole.state);
  assert.equal(hash(decode(cp, 80)!), hash(whole.state));
  assert.equal(decode(cp, 79), undefined);
  const corrupt = structuredClone(cp);
  corrupt[8] = {};
  assert.equal(decode(corrupt, 80), undefined);
  assert.equal(docksideGame.isEntry([1, 5, PLAY, "canal", 128]), false);
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
