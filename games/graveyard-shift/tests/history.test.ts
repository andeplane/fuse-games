import test from "node:test";
import assert from "node:assert/strict";
import { DURATION, createWorld } from "../src/engine/world.js";
import { createRoom, decode, encode, foldTick, hash } from "../src/online/game.js";
import { isHunterBot, parseShiftCompletion, shiftReceipts } from "../src/online/result.js";
import { createResultsHistory } from "fuse-ui/results-history";
import { graveyardRegistration } from "../src/platform.js";

const A = "a".repeat(24), B = "b".repeat(24);
function finalTick() {
  const room = createRoom("shift:1", { display: false });
  for (const [slot, id, name] of [[0, A, "Ada"], [1, B, "Bo"], [2, "bot:2", "Misty Mae"]] as const) {
    room.seats.set(id, { id, name, slot, avatarId: "hunter", bot: isHunterBot(id), connected: true, ...(isHunterBot(id) ? {} : { generation: 1 }) });
  }
  room.stage = "running";
  room.round = 1;
  room.world = createWorld(1, [...room.seats.values()]);
  room.tick = DURATION;
  room.world.tick = DURATION - 1;
  room.world.hunters[0]!.score = 8;
  room.world.hunters[1]!.score = 3;
  return room;
}

test("a completed shift freezes scores, names, human finishers and the deciding tick", () => {
  const room = finalTick();
  room.seats.get(B)!.connected = false;
  assert.equal(Boolean(room.completion), false);
  foldTick(room, A, new Map());
  const receipt = structuredClone(room.completion)!;
  assert.equal(receipt.clock, DURATION + 1);
  assert.equal(receipt.result.winnerId, A);
  assert.deepEqual(receipt.result.finishers, [A]);
  assert.deepEqual(receipt.result.players.map(player => [player.name, player.matchScoreUnits, player.earlyExits]), [["Ada", 8, 0], ["Bo", 3, 1], ["Misty Mae", 0, 0]]);
  room.seats.get(A)!.name = "Changed";
  room.seats.delete(B);
  foldTick(room, A, new Map());
  assert.deepEqual(room.completion, receipt);
  const restored = decode(encode(room), room.tick)!;
  assert.ok(restored);
  assert.deepEqual(restored.completion, receipt);
  assert.equal(hash(restored), hash(room));
});

test("ties and scoreless shifts never invent a unique winner", () => {
  for (const score of [0, 5]) {
    const room = finalTick();
    for (const hunter of room.world!.hunters) hunter.score = score;
    foldTick(room, A, new Map());
    assert.equal(room.completion!.result.winnerId, undefined);
    assert.ok(room.completion!.result.players.every(player => player.matchPlacement === 1 && player.roundWins === (score ? 1 : 0)));
  }
});

test("checkpoint validation rejects forged score, finisher, clock, duplicate seat and missing completion", () => {
  const room = finalTick();
  foldTick(room, A, new Map());
  for (const corrupt of [
    (receipt: NonNullable<typeof room.completion>) => { receipt.result.players[0]!.matchScoreUnits++; },
    (receipt: NonNullable<typeof room.completion>) => { receipt.result.finishers.push("bot:2"); },
    (receipt: NonNullable<typeof room.completion>) => { receipt.clock = room.tick + 1; },
    (receipt: NonNullable<typeof room.completion>) => { receipt.result.players[1]!.slot = 0; },
  ]) {
    const encoded = encode(room), receipt = structuredClone(room.completion)!;
    corrupt(receipt);
    encoded[8] = receipt;
    assert.equal(decode(encoded, room.tick), undefined);
  }
  const encoded = encode(room);
  encoded[8] = null;
  assert.equal(decode(encoded, room.tick), undefined);
  assert.equal(parseShiftCompletion({ ...room.completion, extra: true }), undefined);
});

test("Graveyard history validates base stats without enabling Elo", () => {
  const room = finalTick();
  foldTick(room, A, new Map());
  assert.equal(graveyardRegistration.ratesRounds, false);
  for (const player of room.completion!.result.players) {
    assert.deepEqual(graveyardRegistration.parseStats(player, 1), player);
    assert.equal(graveyardRegistration.parseStats({ ...player, extra: 1 }, 1), undefined);
  }
  assert.equal(isHunterBot("bot:2"), true);
  assert.equal(isHunterBot(A), false);
});

test("the game adapter sends one round and match only after confirmation, from a human participant", async () => {
  const room = finalTick(), calls: { url: string; body: unknown }[] = [];
  const history = createResultsHistory({ gameId: "graveyard-shift", apiUrl: path => `https://api.example${path}`, room: { code: "ABCD", token: "capability" }, signedIn: () => false, playerId: () => A, now: () => 0, fetch: async (input, init) => {
    calls.push({ url: String(input), body: JSON.parse(String(init?.body)) });
    return Response.json({ status: "confirmed" });
  } });
  assert.deepEqual(shiftReceipts(room), []);
  foldTick(room, A, new Map());
  history.observe(shiftReceipts(room), room.tick - 1);
  assert.equal(calls.length, 0);
  history.observe(shiftReceipts(room), room.tick);
  await new Promise<void>(resolve => setImmediate(resolve));
  history.observe(shiftReceipts(room), room.tick);
  assert.deepEqual(calls.map(call => call.url), ["https://api.example/api/games/graveyard-shift/rooms/ABCD/round-results", "https://api.example/api/games/graveyard-shift/rooms/ABCD/results"]);
  assert.deepEqual(calls[1]!.body, { result: room.completion!.result });
  history.dispose();
  const spectator = createResultsHistory({ gameId: "graveyard-shift", apiUrl: path => path, room: { code: "ABCD", token: "spectator" }, signedIn: () => false, playerId: () => "watcher", now: () => 0, fetch: async () => { assert.fail("spectators cannot report"); } });
  spectator.observe(shiftReceipts(room), room.tick);
  spectator.dispose();
});

test("a signed-out solo shift stays reportable after signing in", () => {
  const room = finalTick(), calls: string[] = [];
  let signedIn = false;
  const seat = room.seats.get(A)!;
  room.seats.delete(A);
  room.seats.set("solo", { ...seat, id: "solo" });
  room.seats.delete(B);
  room.world!.hunters = room.world!.hunters.filter(hunter => hunter.id !== B);
  room.world!.hunters[0]!.id = "solo";
  foldTick(room, "solo", new Map());
  const history = createResultsHistory({ gameId: "graveyard-shift", apiUrl: path => path, signedIn: () => signedIn, playerId: () => "solo", now: () => 0, fetch: async (input, init) => {
    calls.push(String(input));
    assert.equal(new Headers(init?.headers).has("Authorization"), false);
    return Response.json({ status: "confirmed" });
  } });
  history.observe(shiftReceipts(room), room.tick);
  assert.deepEqual(calls, []);
  signedIn = true;
  history.observe(shiftReceipts(room), room.tick);
  assert.deepEqual(calls, ["/api/games/graveyard-shift/me/round-results", "/api/games/graveyard-shift/me/results"]);
  history.dispose();
});
