import test from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { createDevRoomService } from "../src/dev.js";

test("F-04: absent and unauthorized room lookups have identical responses and aggregate misses", async () => {
  let now = 1_000_000;
  const entries: Record<string, unknown>[] = [];
  const service = createDevRoomService({
    now: () => now,
    log: (entry) => entries.push(entry),
  });
  await new Promise<void>((resolve) =>
    service.server.listen(0, "127.0.0.1", resolve),
  );
  const origin = `http://127.0.0.1:${(service.server.address() as AddressInfo).port}`;
  const call = (path: string, method = "GET", token = "e".repeat(64)) =>
    fetch(origin + path, {
      method,
      headers: { Authorization: `Bearer ${token}` },
    });
  try {
    const created = await call("/api/rooms", "POST");
    const room = (await created.json()) as { code: string; token: string };
    const absent = room.code === "ZZZZZZ" ? "000000" : "ZZZZZZ";
    for (const [path, method] of [
      ["ice", "GET"],
      ["end", "POST"],
    ] as const) {
      const a = await call(`/api/rooms/${absent}/${path}`, method);
      const b = await call(`/api/rooms/${room.code}/${path}`, method);
      assert.equal(a.status, 404);
      assert.equal(b.status, a.status);
      assert.equal(await b.text(), await a.text());
    }
    for (let i = 0; i < 26; i++) {
      now += 120_000;
      await call(`/api/rooms/${absent}/ice`);
    }
    assert.deepEqual(
      entries.filter((e) => e.kind === "room-lookup-misses"),
      [{ kind: "room-lookup-misses", count: 30 }],
    );
    const ended = await call(`/api/rooms/${room.code}/end`, "POST", room.token);
    assert.equal(ended.status, 200);
  } finally {
    await service.close();
  }
});
