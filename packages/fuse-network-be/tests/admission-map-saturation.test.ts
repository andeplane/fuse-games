import test from "node:test";
import assert from "node:assert/strict";
import { AdmissionGate } from "../src/admission-gate.js";
import { digest, RoomError, type RoomDatabase } from "../src/room-store.js";

test("F-02: saturated admission cache preserves fresh allowances, shared blocks and pending bounds", async () => {
  let calls = 0;
  const allowed = new Set([
    digest("admission:pending"),
    digest("admission:fresh"),
  ]);
  const database: Pick<RoomDatabase, "allowance"> = {
    async allowance(key) {
      calls++;
      return allowed.has(key);
    },
  };
  const logs: { kind: "admission-map-saturated" }[] = [];
  const gate = new AdmissionGate(
    database,
    () => 1000,
    (entry) => logs.push(entry),
  );
  const limited = (error: unknown) =>
    error instanceof RoomError && error.status === 429;
  let release = () => {};
  const wait = new Promise<void>((resolve) => {
    release = resolve;
  });
  // This entry precedes every blocked entry; eviction must skip its pending work.
  const pending = Array.from({ length: 4 }, () =>
    gate.run("pending", () => wait),
  );
  try {
    for (let i = 0; i < 9999; i++)
      await assert.rejects(
        gate.run(`blocked-${i}`, async () => {}),
        limited,
      );
    const beforeFresh = calls;
    assert.equal(await gate.run("fresh", async () => "joined"), "joined");
    assert.equal(
      calls,
      beforeFresh + 1,
      "fresh address checks shared allowance",
    );
    assert.deepEqual(logs, [{ kind: "admission-map-saturated" }]);

    const beforePending = calls;
    await assert.rejects(
      gate.run("pending", async () => {}),
      limited,
    );
    assert.equal(
      calls,
      beforePending,
      "pending per-address bound survives eviction",
    );

    // The evicted blocked address is still blocked by its shared allowance.
    await assert.rejects(
      gate.run("blocked-0", async () => {}),
      limited,
    );
    assert.equal(calls, beforePending + 1);
    const afterRecache = calls;
    await assert.rejects(
      gate.run("blocked-0", async () => {}),
      limited,
    );
    assert.equal(
      calls,
      afterRecache,
      "known blocked address still uses the cache",
    );
    await assert.rejects(
      gate.run("extra-blocked", async () => {}),
      limited,
    );
    assert.equal(
      logs.length,
      1,
      "saturation logging cannot amplify every admission",
    );
  } finally {
    release();
    await Promise.all(pending);
  }
});
