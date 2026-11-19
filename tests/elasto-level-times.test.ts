import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import test from "node:test";
import type { RuntimeDependencies } from "fuse-netcode";
import { MemoryTelemetryDatabase } from "fuse-telemetry/metrics-memory";
import { createDevRoomService } from "fuse-network-be";
import {
  LEVELS,
  STEPS_PER_SECOND,
} from "../games/elasto-fuse/src/engine/index.js";
import { rideBits } from "../games/elasto-fuse/src/app/rides.js";
import { verifiedTime } from "../games/elasto-fuse/src/level-times.js";
import { DEFAULT_SETTINGS } from "../games/elasto-fuse/src/online/game.js";
import { ElastoFuseRuntime } from "../games/elasto-fuse/src/online/runtime.js";
import { elastoLevelTimesHttp } from "../service/elasto-level-times.js";

/** Drive the normal solo runtime from the controls of a known finishing ride. */
function finishSolo() {
  const id = "00000lk";
  const level = LEVELS.findIndex((level) => level.id === id);
  const inputs = rideBits(id);
  let now = 0;
  const dependencies: RuntimeDependencies = {
    now: () => now,
    hidden: () => false,
    token: () => "match",
    generation: () => 1,
    schedule: () => () => {},
    onVisibilityChange: () => () => {},
  };
  const runtime = new ElastoFuseRuntime(
    "SOLO",
    { ...DEFAULT_SETTINGS, level },
    { state: () => {}, event: () => {}, status: () => {}, ready: () => {} },
    { humanName: "Ada", humanAvatar: "fox", dependencies },
  );
  runtime.start();
  assert.equal(runtime.soloRun(), undefined);
  const stepMs = 1000 / STEPS_PER_SECOND;
  for (let step = 0; step < inputs.length + 300; step++) {
    now = step * stepMs + 0.1;
    const ride = runtime.localRide();
    const at = Math.floor(ride?.step ?? -1);
    if (at >= 0) runtime.input(inputs[at] ?? 0);
    runtime.tickLoop();
    const run = runtime.soloRun();
    if (run) {
      const time = runtime.roomState()?.world?.riders[0]?.run;
      assert.equal(
        verifiedTime(run),
        time,
        "proof replays the time the player saw",
      );
      runtime.stop();
      return { run, time };
    }
  }
  runtime.stop();
  assert.fail("the fixture did not finish through the solo runtime");
}

test("a signed-in solo finish ranks by replay time, and malformed or unsigned submissions leave the board alone", async () => {
  const { run, time } = finishSolo();
  const service = createDevRoomService({
    gameIds: ["elasto-fuse"],
    httpExtension: () =>
      elastoLevelTimesHttp(
        new MemoryTelemetryDatabase(),
        {
          accounts: async (uids) =>
            new Map(
              uids.map((uid) => [uid, { username: "Ada", updatedAt: 0 }]),
            ),
        },
        async (token) => (token === "signed-in" ? "private-id" : undefined),
        "a".repeat(32),
        () => 500,
      ),
  });
  await new Promise<void>((resolve) =>
    service.server.listen(0, "127.0.0.1", resolve),
  );
  const port = (service.server.address() as AddressInfo).port;
  const url = `http://127.0.0.1:${port}/api/games/elasto-fuse/level-times?level=${run.level}`;
  const post = (body: unknown, token?: string) =>
    fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body),
    });
  try {
    assert.deepEqual(await (await fetch(url)).json(), { players: [] });
    assert.equal((await post(run)).status, 401);
    for (const invalid of [
      { ...run, rules: "old" },
      { ...run, level: 0 },
      { ...run, steps: run.steps - 1 },
      { ...run, steps: run.steps + 1 },
      { ...run, inputs: [[0, 64]] },
      {
        ...run,
        inputs: [
          [1, 0],
          [1, 1],
        ],
      },
      { ...run, steps: Number.MAX_SAFE_INTEGER },
    ]) {
      assert.equal((await post(invalid, "signed-in")).status, 400);
    }
    const save = await post({ ...run, time: 1, name: "client" }, "signed-in");
    assert.equal(save.status, 200);
    assert.deepEqual(await save.json(), { steps: time, ranked: true });
    const duplicate = await post(run, "signed-in");
    assert.equal(duplicate.status, 200);
    assert.deepEqual(await (await fetch(url)).json(), {
      players: [{ name: "Ada", steps: time }],
    });
  } finally {
    await service.close();
  }
});
