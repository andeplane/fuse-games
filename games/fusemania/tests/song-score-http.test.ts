import test from "node:test";
import assert from "node:assert/strict";
import { publicIdOf } from "fuse-platform";
import { createServer } from "node:http";
import { once } from "node:events";
import { RoomError } from "fuse-network-be";
import { MemoryTelemetryDatabase } from "fuse-telemetry/metrics-memory";
import { SharedTelemetryQuota } from "fuse-telemetry/limits";
import { createSongScoresHttp } from "../src/server/score-http.js";
import { SongScores } from "../src/server/song-scores.js";
import { createLibrary, SOLO_LEAD_IN_MS } from "../src/engine/index.js";
import { GRID_SSC } from "./fixtures/songs.js";

test("HTTP runs require verified identity, bounded JSON, and known canonical charts; public reads hide evidence", async (t) => {
  const database = new MemoryTelemetryDatabase(),
    sources = [{ id: "grid", ssc: GRID_SSC, audio: "" }],
    library = createLibrary(sources);
  let now = 100_000;
  const scores = new SongScores({
    database,
    library,
    sources,
    rules: "test",
    now: () => now,
    id: () => "a".repeat(32),
    accounts: {
      accounts: async (uids) =>
        new Map(uids.map((uid) => [uid, { username: "Ada", updatedAt: now }])),
    },
  });
  const extension = createSongScoresHttp({
    scores,
    identity: async (token) =>
      token === "valid-test-identity" ? "ada" : undefined,
    quota: new SharedTelemetryQuota(database, "a".repeat(32), () => now),
    now: () => now,
  });
  const server = createServer((req, res) => {
    void extension.handle(req, res, "127.0.0.1").catch((error) => {
      res.writeHead(error instanceof RoomError ? error.status : 500, {
        "Content-Type": "application/json",
      });
      res.end(JSON.stringify({ error: error.message }));
    });
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(
    () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
        server.closeAllConnections();
      }),
  );
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const url = `http://127.0.0.1:${address.port}/api/games/fusemania/song-scores`;
  const post = (path: string, data: unknown, token = "valid-test-identity") =>
    fetch(url + path, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(data),
    });
  const catalog = (await (await fetch(url)).json()) as {
    songs: { charts: { version: string }[] }[];
  };
  const start = {
    song: "grid",
    chart: 0,
    version: catalog.songs[0]!.charts[0]!.version,
    leadIn: SOLO_LEAD_IN_MS,
  };
  assert.equal((await post("/runs", start, "forged")).status, 401);
  assert.equal(
    (
      await fetch(url + "/runs", {
        method: "POST",
        headers: { Authorization: "Bearer valid-test-identity" },
        body: "x",
      })
    ).status,
    415,
  );
  assert.equal((await post("/runs", { ...start, chart: 99 })).status, 400);
  assert.equal((await post("/runs", start)).status, 200);
  const run = `/runs/${"a".repeat(32)}`;
  assert.equal((await post(run, { inputs: [], rating: 0 })).status, 409);
  now += library.song("grid")!.endMs + 4000;
  assert.equal((await post(run, { inputs: [], rating: 0 })).status, 200);
  const board = await (await fetch(url + "?song=grid&chart=0")).json();
  assert.deepEqual(board, {
    players: [{ publicId: publicIdOf("ada"), name: "Ada", rating: 0, endedAt: now }],
  });
  assert.equal((await fetch(url + "?song=grid")).status, 400);
  assert.equal((await fetch(url, { method: "DELETE" })).status, 405);
  assert.equal(
    (
      await fetch(url + "/runs", {
        method: "POST",
        headers: {
          Authorization: "Bearer valid-test-identity",
          "Content-Type": "application/json",
        },
        body: "{",
      })
    ).status,
    400,
  );
  assert.equal((await post("/runs", "x".repeat(750_001))).status, 413);
});
