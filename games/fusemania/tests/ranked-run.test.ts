import test from "node:test";
import assert from "node:assert/strict";
import {
  RankedRun,
  type RankObservation,
  type RankDependencies,
} from "../src/app/ranked-run.js";

const observation: RankObservation = {
  key: "song-1",
  song: "grid",
  chart: 0,
  leadIn: 2500,
  eligible: true,
  beforeSong: true,
  finished: false,
  confirmed: false,
  rating: 100_000,
};
const flush = async () => {
  for (let i = 0; i < 12; i++) await Promise.resolve();
};
function setup(extra: Partial<RankDependencies> = {}) {
  const calls: string[] = [];
  const run = new RankedRun({
    token: async () => "identity",
    version: async () => "v1",
    inputs: () => [],
    changed() {},
    post: async (path) => {
      calls.push(path);
      return path === "/runs"
        ? { id: "ticket" }
        : { rating: observation.rating };
    },
    ...extra,
  });
  return { run, calls };
}
test("only confirmed completion submits; repeated frames submit once", async () => {
  const { run, calls } = setup();
  run.observe(observation);
  await flush();
  run.observe({ ...observation, finished: true });
  await flush();
  assert.deepEqual(calls, ["/runs"]);
  const done = { ...observation, finished: true, confirmed: true };
  run.observe(done);
  await flush();
  run.observe(done);
  await flush();
  assert.deepEqual(calls, ["/runs", "/runs/ticket"]);
  assert.match(run.status, /Verified score saved/);
});
test("guests, battle/custom songs and late joins do not request a run", async () => {
  const guest = setup({ token: async () => undefined });
  guest.run.observe(observation);
  await flush();
  assert.deepEqual(guest.calls, []);
  const other = setup();
  other.run.observe({ ...observation, eligible: false });
  await flush();
  assert.deepEqual(other.calls, []);
  other.run.observe({ ...observation, key: "late", beforeSong: false });
  await flush();
  assert.deepEqual(other.calls, []);
});
test("completion failure is visible and retryable, invalidated evidence cannot be sent", async () => {
  let fails = true;
  const { run } = setup({
    post: async (path) => {
      if (path === "/runs") return { id: "ticket" };
      if (fails) throw new Error("Offline");
      return { rating: observation.rating };
    },
  });
  run.observe(observation);
  await flush();
  run.observe({ ...observation, finished: true, confirmed: true });
  await flush();
  assert.equal(run.canRetry, true);
  assert.match(run.status, /Score not saved: Offline/);
  fails = false;
  run.retry();
  await flush();
  assert.equal(run.canRetry, false);
  assert.match(run.status, /Verified/);
  const invalid = setup({ inputs: () => undefined });
  invalid.run.observe(observation);
  await flush();
  invalid.run.observe({ ...observation, finished: true, confirmed: true });
  await flush();
  assert.deepEqual(invalid.calls, ["/runs"]);
  assert.match(invalid.run.status, /lost input evidence/);
});
test("a stale token refresh cannot submit to the new match's ticket", async () => {
  let resolve!: (token: string) => void,
    tokens = 0;
  const { run, calls } = setup({
    token: async () =>
      ++tokens === 2
        ? new Promise((done) => {
            resolve = done;
          })
        : "identity",
  });
  run.observe(observation);
  await flush();
  run.observe({ ...observation, finished: true, confirmed: true });
  await flush();
  run.observe({ ...observation, key: "song-2" });
  await flush();
  resolve("identity");
  await flush();
  assert.deepEqual(calls, ["/runs", "/runs"]);
});
