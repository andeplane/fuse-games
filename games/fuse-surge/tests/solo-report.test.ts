import test from "node:test";
import assert from "node:assert/strict";
import { ACTION, BOT, JOIN } from "fuse-netcode";
import { dueReports, sendReport } from "../src/app/reports.js";
import { DEFAULT_SETTINGS, createRoom } from "../src/online/game.js";
import { finish, fold } from "./fixtures/room.js";

function completedSolo() {
  const room = createRoom("solo-lobby", { ...DEFAULT_SETTINGS, target: 1 });
  fold(room, { a: [
    [JOIN, "solo", "Ada", 0, "robot", 1],
    [BOT, "add", "bot:1", "Robo", 1],
    [ACTION, "start", "solo-match"],
  ] });
  finish(room);
  return room;
}

test("a confirmed solo human owes the frozen round and match; spectators and bots do not", () => {
  const room = completedSolo(), sent = new Set<string>();
  assert.deepEqual(dueReports(room, "solo", room.decided!.clock - 1, sent), []);
  const reports = dueReports(room, "solo", room.decided!.clock, sent);
  assert.deepEqual(reports.map(report => report.path), ["round-results", "results"]);
  assert.deepEqual(reports[0]!.result.finishers, ["solo"]);
  assert.deepEqual(dueReports(room, "bot:1", room.simulationTick, sent), []);
  assert.deepEqual(dueReports(room, "watcher", room.simulationTick, sent), []);
  reports.forEach(report => sent.add(report.key));
  assert.deepEqual(dueReports(room, "solo", room.simulationTick, sent), []);
});

test("solo transport omits a room capability and leaves normalization to the shared identity boundary", async () => {
  const room = completedSolo();
  const report = dueReports(room, "solo", room.simulationTick, new Set())[1]!;
  const original = structuredClone(report), calls: RequestInit[] = [];
  const fetcher: typeof fetch = async (_url, init) => {
    calls.push(init ?? {});
    return Response.json({ status: "confirmed" });
  };
  assert.equal(await sendReport("/api/games/fuse-surge/me/results", report, { fetch: fetcher }), "confirmed");
  assert.equal(new Headers(calls[0]!.headers).has("Authorization"), false);
  assert.deepEqual(JSON.parse(String(calls[0]!.body)), { result: report.result });
  assert.deepEqual(report, original);
  assert.equal(await sendReport("/api/games/fuse-surge/rooms/AB12/results", report, { fetch: fetcher, roomToken: "room-capability" }), "confirmed");
  assert.equal(new Headers(calls[1]!.headers).get("Authorization"), "Bearer room-capability");
});
