import test from "node:test";
import assert from "node:assert/strict";
import { DURATION, createWorld } from "../src/engine/world.js";
import {
  createRoom,
  decode,
  encode,
  foldTick,
  hash,
} from "../src/online/game.js";
import {
  isHunterBot,
  parseShiftCompletion,
  shiftReceipts,
} from "../src/online/result.js";
import { createResultsHistory } from "fuse-ui/results-history";
import { readShiftHistory } from "../src/app/history.js";
import { ACTION, type StreamEntries } from "fuse-netcode";
import type { Entry, Room } from "../src/online/game.js";
import { graveyardRegistration } from "../src/platform.js";

const A = "a".repeat(24),
  B = "b".repeat(24);
function act(room: Room, action: "lobby" | "start" | "rematch", id: string) {
  const streams = new Map<string, StreamEntries<Entry>>([
    [A, { generation: 1, entries: [[1, room.tick + 1, ACTION, action, id]] }],
  ]);
  foldTick(room, A, streams);
}
function finalTick() {
  const room = createRoom("shift:1", { display: false });
  for (const [slot, id, name] of [
    [0, A, "Ada"],
    [1, B, "Bo"],
    [2, "bot:2", "Misty Mae"],
  ] as const) {
    room.seats.set(id, {
      id,
      name,
      slot,
      avatarId: "hunter",
      bot: isHunterBot(id),
      connected: true,
      ...(isHunterBot(id) ? {} : { generation: 1 }),
    });
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
  assert.deepEqual(
    receipt.result.players.map((player) => [
      player.name,
      player.matchScoreUnits,
      player.earlyExits,
    ]),
    [
      ["Ada", 8, 0],
      ["Bo", 3, 1],
      ["Misty Mae", 0, 0],
    ],
  );
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
    assert.ok(
      room.completion!.result.players.every(
        (player) =>
          player.matchPlacement === 1 && player.roundWins === (score ? 1 : 0),
      ),
    );
  }
});

test("checkpoint validation rejects forged score, finisher, clock, duplicate seat and missing completion", () => {
  const room = finalTick();
  foldTick(room, A, new Map());
  for (const corrupt of [
    (receipt: NonNullable<typeof room.completion>) => {
      receipt.result.players[0]!.matchScoreUnits++;
    },
    (receipt: NonNullable<typeof room.completion>) => {
      receipt.result.finishers.push("bot:2");
    },
    (receipt: NonNullable<typeof room.completion>) => {
      receipt.clock = room.tick + 1;
    },
    (receipt: NonNullable<typeof room.completion>) => {
      receipt.result.players[1]!.slot = 0;
    },
  ]) {
    const encoded = encode(room),
      receipt = structuredClone(room.completion)!;
    corrupt(receipt);
    encoded[8] = receipt;
    assert.equal(decode(encoded, room.tick), undefined);
  }
  const encoded = encode(room);
  encoded[8] = null;
  assert.equal(decode(encoded, room.tick), undefined);
  assert.equal(
    parseShiftCompletion({ ...room.completion, extra: true }),
    undefined,
  );
});

test("Graveyard history validates base stats without enabling Elo", () => {
  const room = finalTick();
  foldTick(room, A, new Map());
  assert.equal(graveyardRegistration.ratesRounds, false);
  for (const player of room.completion!.result.players) {
    assert.deepEqual(graveyardRegistration.parseStats(player, 1), player);
    assert.equal(
      graveyardRegistration.parseStats({ ...player, extra: 1 }, 1),
      undefined,
    );
  }
  assert.equal(isHunterBot("bot:2"), true);
  assert.equal(isHunterBot(A), false);
});

test("the game adapter sends one round and match only after confirmation, from a human participant", async () => {
  const room = finalTick(),
    calls: { url: string; body: unknown }[] = [];
  const history = createResultsHistory({
    gameId: "graveyard-shift",
    apiUrl: (path) => `https://api.example${path}`,
    room: { code: "ABCD", token: "capability" },
    signedIn: () => false,
    playerId: () => A,
    now: () => 0,
    fetch: async (input, init) => {
      calls.push({ url: String(input), body: JSON.parse(String(init?.body)) });
      return Response.json({ status: "confirmed" });
    },
  });
  assert.deepEqual(shiftReceipts(room), []);
  foldTick(room, A, new Map());
  history.observe(shiftReceipts(room), room.tick - 1);
  assert.equal(calls.length, 0);
  history.observe(shiftReceipts(room), room.tick);
  await new Promise<void>((resolve) => setImmediate(resolve));
  history.observe(shiftReceipts(room), room.tick);
  assert.deepEqual(
    calls.map((call) => call.url),
    [
      "https://api.example/api/games/graveyard-shift/rooms/ABCD/round-results",
      "https://api.example/api/games/graveyard-shift/rooms/ABCD/results",
    ],
  );
  assert.deepEqual(calls[1]!.body, { result: room.completion!.result });
  history.dispose();
  const spectator = createResultsHistory({
    gameId: "graveyard-shift",
    apiUrl: (path) => path,
    room: { code: "ABCD", token: "spectator" },
    signedIn: () => false,
    playerId: () => "watcher",
    now: () => 0,
    fetch: async () => {
      assert.fail("spectators cannot report");
    },
  });
  spectator.observe(shiftReceipts(room), room.tick);
  spectator.dispose();
});

test("a signed-out solo shift stays reportable after signing in", async () => {
  const room = finalTick(),
    calls: string[] = [];
  let signedIn = false;
  const seat = room.seats.get(A)!;
  room.seats.delete(A);
  room.seats.set("solo", { ...seat, id: "solo" });
  room.seats.delete(B);
  room.world!.hunters = room.world!.hunters.filter((hunter) => hunter.id !== B);
  room.world!.hunters[0]!.id = "solo";
  foldTick(room, "solo", new Map());
  const history = createResultsHistory({
    gameId: "graveyard-shift",
    apiUrl: (path) => path,
    signedIn: () => signedIn,
    playerId: () => "solo",
    now: () => 0,
    fetch: async (input, init) => {
      calls.push(String(input));
      assert.equal(new Headers(init?.headers).has("Authorization"), false);
      return Response.json({ status: "confirmed" });
    },
  });
  history.observe(shiftReceipts(room), room.tick);
  assert.equal(calls.length, 0);
  signedIn = true;
  history.observe(shiftReceipts(room), room.tick);
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.deepEqual(calls, [
    "/api/games/graveyard-shift/me/round-results",
    "/api/games/graveyard-shift/me/results",
  ]);
  history.dispose();
});

test("a fast lobby/rematch retains rollback-corrected results until confirmation passes the deciding tick", async () => {
  const predicted = finalTick(),
    before = decode(encode(predicted), predicted.tick)!;
  const calls: { result: { players: { matchScoreUnits: number }[] } }[] = [];
  const history = createResultsHistory({
    gameId: "graveyard-shift",
    apiUrl: (path) => path,
    room: { code: "AB12", token: "capability" },
    signedIn: () => false,
    playerId: () => A,
    now: () => 0,
    fetch: async (_url, init) => {
      calls.push(JSON.parse(String(init?.body)));
      return Response.json({ status: "confirmed" });
    },
  });
  foldTick(predicted, A, new Map());
  assert.equal(predicted.completion!.clock % 4, 1);
  history.observe(shiftReceipts(predicted), predicted.tick - 1);
  assert.equal(calls.length, 0);
  // A replay correction replaces the speculative receipt in authoritative room state.
  before.world!.hunters[0]!.score = 9;
  foldTick(before, A, new Map());
  const decidingTick = before.tick;
  act(before, "lobby", "next-lobby");
  act(before, "start", "next-shift");
  assert.equal(before.completion, null);
  const recovered = decode(encode(before), before.tick)!;
  assert.ok(recovered);
  assert.equal(recovered.completions[0]!.clock, decidingTick);
  history.observe(shiftReceipts(recovered), decidingTick - 1);
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(calls.length, 0);
  history.observe(shiftReceipts(recovered), decidingTick);
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(calls.length, 2);
  assert.ok(
    calls.every((call) => call.result.players[0]!.matchScoreUnits === 9),
  );
  history.observe(shiftReceipts(recovered), recovered.tick);
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(calls.length, 2);
  history.dispose();
});

test("retained shift history stays bounded and rejects corrupt checkpoint lists", () => {
  const room = finalTick();
  foldTick(room, A, new Map());
  for (let index = 0; index < 9; index++) {
    act(room, "rematch", `again-${index}`);
    room.world!.tick = DURATION - 1;
    foldTick(room, A, new Map());
  }
  assert.equal(room.completions.length, 8);
  assert.equal(shiftReceipts(room).length, 16);
  assert.ok(decode(encode(room), room.tick));
  const encoded = encode(room);
  encoded[9] = [...room.completions, room.completions[0]];
  assert.equal(decode(encoded, room.tick), undefined);
  encoded[9] = [room.completions[0], room.completions[0]];
  assert.equal(decode(encoded, room.tick), undefined);
  encoded[9] = room.completions.slice(0, -1);
  assert.equal(decode(encoded, room.tick), undefined);
});

test("ordinary leave drains fresh outcomes against the closed log snapshot before stopping", async () => {
  let room = finalTick(),
    closedLogTick: number | undefined,
    stopped = 0,
    now = 0;
  const calls: { result: { players: { matchScoreUnits: number }[] } }[] = [];
  const polls = new Set<() => void>();
  const runtime = {
    roomState: () => room,
    confirmedFrame: () =>
      closedLogTick === undefined ? undefined : { logTick: closedLogTick },
    // The live game clock is insufficient proof; the composition helper must ignore it.
    confirmedTick: () => room.tick,
  };
  const history = createResultsHistory({
    gameId: "graveyard-shift",
    apiUrl: (path) => path,
    room: { code: "AB12", token: "capability" },
    signedIn: () => false,
    playerId: () => A,
    now: () => now,
    schedule: (callback) => {
      polls.add(callback);
      return () => polls.delete(callback);
    },
    fetch: async (_url, init) => {
      calls.push(JSON.parse(String(init?.body)));
      return Response.json({ status: "confirmed" });
    },
  });
  const before = decode(encode(room), room.tick)!;
  foldTick(room, A, new Map());
  assert.equal(readShiftHistory(runtime).confirmedTick, -1);
  history.close(
    () => readShiftHistory(runtime),
    () => {
      stopped++;
    },
  );
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(calls.length, 0);
  assert.equal(stopped, 0);
  // Confirmation polling reads the corrected rollback state, never the result seen on Back.
  room = before;
  room.world!.hunters[0]!.score = 11;
  foldTick(room, A, new Map());
  closedLogTick = room.tick;
  now = 50;
  for (const callback of [...polls]) callback();
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(calls.length, 2);
  assert.ok(
    calls.every((call) => call.result.players[0]!.matchScoreUnits === 11),
  );
  assert.equal(stopped, 1);
  assert.equal(polls.size, 0);
  history.dispose();
  assert.equal(stopped, 1);
});
