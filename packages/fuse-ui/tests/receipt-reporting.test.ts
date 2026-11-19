import assert from "node:assert/strict";
import test from "node:test";
import {
  createReceiptReporter,
  createSingleRoundReceipts,
  type MatchReceipt,
} from "../src/receipt-reporting.js";

const result = {
  matchId: "m1",
  length: 1,
  finishers: ["a"],
  players: [],
};
const receipt: MatchReceipt = { key: "m1:match", path: "results", result };

test("solo receipts wait for sign-in, and a failed receipt is deduplicated", () => {
  let signedIn = false;
  let ticksRead = 0;
  const requests: { url: string; request: RequestInit | undefined }[] = [];
  const reporter = createReceiptReporter<string>({
    due: (_room, me, confirmedTick, sent) =>
      me === "a" && confirmedTick === 5 && !sent.has(receipt.key)
        ? [receipt]
        : [],
    scope: { kind: "solo", signedIn: () => signedIn },
    display: false,
    gameId: "dice",
    apiUrl: (path) => path,
    fetch: async (url, request) => {
      requests.push({ url: String(url), request });
      return new Response(null, { status: 400 });
    },
    playerId: () => "a",
    confirmedTick: () => {
      ticksRead++;
      return 5;
    },
  });
  reporter("lobby");
  assert.equal(ticksRead, 0);
  signedIn = true;
  reporter(undefined);
  assert.equal(ticksRead, 0);
  reporter("over");
  // The same confirmed view can arrive after the POST has started.
  reporter("over");
  assert.equal(ticksRead, 2);
  assert.equal(requests.length, 1);
  assert.deepEqual(requests[0], {
    url: "/api/games/dice/me/results",
    request: {
      method: "POST",
      body: JSON.stringify({ result }),
      keepalive: true,
      headers: { "Content-Type": "application/json" },
    },
  });
});

test("room receipts carry the room token and displays do not report", () => {
  const requests: { url: string; token: string | null }[] = [];
  for (const display of [true, false]) {
    const reporter = createReceiptReporter<string>({
      due: () => [receipt],
      scope: { kind: "room", code: "ROOM", token: "fixture" },
      display,
      gameId: "dice",
      apiUrl: (path) => path,
      fetch: async (url, request) => {
        requests.push({
          url: String(url),
          token: new Headers(request?.headers).get("Authorization"),
        });
        return new Response(null, { status: 400 });
      },
      playerId: () => "a",
      confirmedTick: () => 5,
    });
    reporter("over");
  }
  assert.deepEqual(requests, [
    { url: "/api/games/dice/rooms/ROOM/results", token: "Bearer fixture" },
  ]);
});

test("a confirmed single-round match owes two independent receipts to its finishers", () => {
  const due = createSingleRoundReceipts({
    isBotId: (id) => id.startsWith("bot:"),
    roundResult: () => ({ ...result, round: 1 }),
    matchResult: () => result,
  });
  const room = {
    matchId: "m1",
    stage: "over",
    decided: { clock: 5, finishers: ["a", "bot:1"] },
  };
  for (const [player, clock] of [
    ["a", 4],
    ["watcher", 5],
    ["bot:1", 5],
  ] as const)
    assert.deepEqual(due(room, player, clock, new Set()), []);
  assert.deepEqual(
    due(room, "a", 5, new Set()).map((report) => report.path),
    ["round-results", "results"],
  );
  assert.deepEqual(due(room, "a", 5, new Set(["m1:1"])), [receipt]);
});
