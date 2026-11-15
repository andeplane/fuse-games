import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { MemoryTelemetryDatabase } from "fuse-telemetry/metrics-memory";
import { SongScores } from "../src/server/song-scores.js";
import { createLibrary, SOLO_LEAD_IN_MS } from "../src/engine/index.js";
import { GRID_SSC } from "./fixtures/songs.js";
import { MAX_RUN_INPUTS, type SongInput } from "../src/song-scores.js";

function setup() {
  const sources = [{ id: "grid", ssc: GRID_SSC, audio: "grid.mp3" }];
  const library = createLibrary(sources),
    database = new MemoryTelemetryDatabase();
  let now = 10_000,
    serial = 0;
  const options = {
    database,
    library,
    sources,
    rules: "test-1",
    now: () => now,
    id: () => (++serial).toString(16).padStart(32, "0"),
    accounts: {
      accounts: async (uids: readonly string[]) =>
        new Map(
          uids.map((uid) => [
            uid,
            { username: uid === "ada" ? "Ada" : "Bo", updatedAt: 0 },
          ]),
        ),
    },
  };
  const scores = new SongScores(options);
  const start = async (uid = "ada", chart = 0) => {
    const version = (await scores.catalog())[0]!.charts[chart]!.version;
    return scores.start(uid, {
      song: "grid",
      chart,
      version,
      leadIn: SOLO_LEAD_IN_MS,
    });
  };
  const inputs: SongInput[] = library
    .steps("grid", 0)!
    .notes.flatMap((note) => [
      { at: Math.ceil(note.ms / 50) * 50, code: note.column, ms: note.ms },
      {
        at: Math.ceil(note.ms / 50) * 50 + 50,
        code: note.column + 4,
        ms: note.ms + 50,
      },
    ]);
  return {
    scores,
    options,
    database,
    start,
    inputs,
    advance: (ms = library.song("grid")!.endMs + 4000) => {
      now += ms;
    },
  };
}

test("replays input evidence, emits a song event and atomically projects the named chart leaderboard", async () => {
  const s = setup(),
    run = await s.start();
  assert.equal((await s.scores.catalog())[0]!.charts[0]!.top, undefined);
  s.advance();
  assert.deepEqual(
    await s.scores.complete("ada", run.id, {
      inputs: s.inputs,
      rating: 1_000_000,
    }),
    { saved: true, rating: 1_000_000 },
  );
  const board = await s.scores.leaderboard("grid", 0);
  assert.equal(board[0]!.name, "Ada");
  assert.equal(board[0]!.rating, 1_000_000);
  assert.ok(!JSON.stringify(board).includes('"uid"'));
  assert.deepEqual(await s.scores.leaderboard("grid", 1), []);
  const [event] = await s.database.readMany([`telemetry-song-runs/${run.id}`]);
  assert.ok(
    event &&
      typeof event === "object" &&
      "name" in event &&
      event.name === "fuse.Song Completed",
  );
  assert.ok(
    event &&
      typeof event === "object" &&
      "percent" in event &&
      event.percent === 100,
  );
});

test("invented totals, malformed/reordered/post-song logs and instant results leave the board empty", async () => {
  const s = setup(),
    run = await s.start();
  await assert.rejects(
    s.scores.complete("ada", run.id, { inputs: s.inputs, rating: 1_000_000 }),
    /not finished/,
  );
  s.advance();
  await assert.rejects(
    s.scores.complete("ada", run.id, { inputs: [], rating: 1_000_000 }),
    /did not match/,
  );
  for (const inputs of [
    [s.inputs[1], s.inputs[0]],
    [{ at: 2001, ms: 2001, code: 0 }],
    [{ at: 2000, ms: 2000, code: 8 }],
    [{ at: 2000, ms: 999_999, code: 0 }],
    [{ at: 100_000, ms: 100_000, code: 0 }],
  ])
    await assert.rejects(
      s.scores.complete("ada", run.id, { inputs, rating: 0 }),
      /Invalid input/,
    );
  assert.deepEqual(await s.scores.leaderboard("grid", 0), []);
});

test("ownership, chart versions, range checks, active ticket and expiry are enforced", async () => {
  const s = setup(),
    run = await s.start();
  await assert.rejects(s.scores.complete("bo", run.id, {}), /not found/);
  const base = {
    song: "grid",
    chart: 0,
    version: (await s.scores.catalog())[0]!.charts[0]!.version,
    leadIn: SOLO_LEAD_IN_MS,
  };
  await assert.rejects(
    s.scores.start("ada", { ...base, chart: 99 }),
    /Unknown song/,
  );
  await assert.rejects(
    s.scores.start("ada", { ...base, song: "custom" }),
    /Unknown song/,
  );
  await assert.rejects(
    s.scores.start("ada", { ...base, version: "old" }),
    /chart changed/,
  );
  await s.start();
  s.advance();
  await assert.rejects(
    s.scores.complete("ada", run.id, { inputs: s.inputs, rating: 1_000_000 }),
    /newer song/,
  );
  const expired = await s.start();
  s.advance(3_600_001);
  await assert.rejects(
    s.scores.complete("ada", expired.id, { inputs: [], rating: 0 }),
    /expired/,
  );
});

test("duplicate/concurrent completion is idempotent, lower scores cannot overwrite a personal best", async () => {
  const s = setup(),
    run = await s.start();
  s.advance();
  const body = { inputs: s.inputs, rating: 1_000_000 };
  const results = await Promise.all([
    s.scores.complete("ada", run.id, body),
    s.scores.complete("ada", run.id, body),
  ]);
  assert.ok(results.every((row) => row.rating === 1_000_000));
  assert.equal((await s.scores.leaderboard("grid", 0)).length, 1);
  assert.equal(
    (await s.scores.complete("ada", run.id, { inputs: [], rating: 0 })).rating,
    1_000_000,
  );
  const lower = await s.start();
  s.advance();
  await s.scores.complete("ada", lower.id, { inputs: [], rating: 0 });
  assert.equal((await s.scores.leaderboard("grid", 0))[0]!.rating, 1_000_000);
  const tied = await s.start("bo");
  s.advance();
  await s.scores.complete("bo", tied.id, body);
  assert.deepEqual(
    (await s.scores.leaderboard("grid", 0)).map((row) => row.name),
    ["Ada", "Bo"],
  );
});

test("a new scoring/chart version gets empty boards while retaining old evidence", async () => {
  const s = setup(),
    run = await s.start();
  s.advance();
  await s.scores.complete("ada", run.id, {
    inputs: s.inputs,
    rating: 1_000_000,
  });
  const changed = new SongScores({ ...s.options, rules: "test-2" });
  assert.deepEqual(await changed.leaderboard("grid", 0), []);
  assert.ok((await s.database.readMany([`telemetry-song-runs/${run.id}`]))[0]);
});

test("corrupt stored tickets fail safely without replaying or overwriting records", async () => {
  const s = setup(),
    run = await s.start();
  s.advance();
  const key = `telemetry-song-runs/${run.id}`;
  const [ticket] = await s.database.readMany([key]);
  assert.ok(ticket && typeof ticket === "object");
  for (const patch of [
    { leadIn: undefined },
    { leadIn: 1e100 },
    { status: "unknown" },
    { startedAt: NaN },
    { expiresAt: -1 },
  ]) {
    await s.database.transact(async (tx) => {
      tx.set(key, { ...ticket, ...patch });
    });
    await assert.rejects(
      s.scores.complete("ada", run.id, { inputs: [], rating: 0 }),
      /Stored song ticket is invalid/,
    );
    assert.deepEqual(await s.scores.leaderboard("grid", 0), []);
  }
});

test("corrupt stored personal best fails without losing the healthy leaderboard", async () => {
  const s = setup(),
    run = await s.start();
  s.advance();
  await s.scores.complete("ada", run.id, {
    inputs: s.inputs,
    rating: 1_000_000,
  });
  const version = (await s.scores.catalog())[0]!.charts[0]!.version;
  const personalKey = `telemetry-song-bests/${createHash("sha256").update(`ada:telemetry-song-boards/${version}_0`).digest("hex")}`;
  await s.database.transact(async (tx) => {
    tx.set(personalKey, {
      uid: "ada",
      name: "Ada",
      rating: "corrupt",
      endedAt: 1,
    });
  });
  const next = await s.start();
  s.advance();
  await assert.rejects(
    s.scores.complete("ada", next.id, { inputs: [], rating: 0 }),
    /Stored song leaderboard is invalid/,
  );
  assert.equal((await s.scores.leaderboard("grid", 0))[0]!.rating, 1_000_000);
});

test("input limit leaves a conservative Firestore document budget and rejects overflowing evidence", async () => {
  // Firestore: each 3-integer map has 11 bytes of field names + 24 of integers + 32 map overhead.
  // Reserve 64KiB for the document name and all completion/ticket metadata.
  assert.ok(MAX_RUN_INPUTS * 67 + 65_536 < 1_048_576);
  const s = setup(),
    run = await s.start();
  s.advance();
  const inputs = Array.from({ length: MAX_RUN_INPUTS + 1 }, () => ({
    at: 2000,
    code: 0,
    ms: 2000,
  }));
  await assert.rejects(
    s.scores.complete("ada", run.id, { inputs, rating: 0 }),
    /Invalid input log/,
  );
});
