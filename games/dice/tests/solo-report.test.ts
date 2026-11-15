import test from "node:test";
import assert from "node:assert/strict";
import { sendReport, type DueReport } from "../src/app/reports.js";

test("solo receipts omit room capabilities and leave IDs for the shared identity boundary", async () => {
  const report: DueReport = {
    key: "solo-match:match",
    path: "results",
    result: {
      matchId: "solo-match",
      length: 1,
      winnerId: "solo",
      finishers: ["solo"],
      players: [],
    },
  };
  const calls: RequestInit[] = [];
  const fetcher: typeof fetch = async (_input, init) => {
    calls.push(init ?? {});
    return Response.json({ status: "confirmed" });
  };
  await sendReport("/api/games/dice/me/results", report, { fetch: fetcher });
  assert.equal(calls.length, 1);
  assert.equal(new Headers(calls[0]!.headers).has("Authorization"), false);
  assert.deepEqual(JSON.parse(String(calls[0]!.body)), {
    result: report.result,
  });
  assert.equal(report.result.winnerId, "solo");
});
