import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { WebSocket } from "ws";
import { authFrame, CLOSE_UNAUTHENTICATED } from "fuse-network-protocol";
import {
  createDevRoomService,
  type DevRoomServiceOptions,
} from "../src/dev.js";
import { peerId } from "../src/room-store.js";
import { AUTH_DEADLINE_MS } from "../src/socket-auth.js";

test("F-10: query credentials never admit a socket or authorize a room HTTP route", async () => {
  const origin = "https://game.example";
  const deadlines: Array<() => void> = [];
  const logs: Array<Record<string, unknown>> = [];
  // A stale JavaScript caller can still pass removed properties; they must never restore the bypass.
  const options: DevRoomServiceOptions & { legacyQueryToken: boolean } = {
    legacyQueryToken: true,
    allowedOrigins: [origin],
    schedule: (callback, delayMs) => {
      if (delayMs === AUTH_DEADLINE_MS) deadlines.push(callback);
      return () => {};
    },
    log: (entry) => logs.push(entry),
  };
  const service = createDevRoomService(options);
  const sockets: WebSocket[] = [];
  try {
    await new Promise<void>((resolve) =>
      service.server.listen(0, "127.0.0.1", resolve),
    );
    const port = (service.server.address() as AddressInfo).port;
    const base = `http://127.0.0.1:${port}/api/rooms`;
    const created = await fetch(base, {
      method: "POST",
      headers: { Origin: origin },
    });
    assert.equal(created.status, 201);
    const { code, token } = (await created.json()) as {
      code: string;
      token: string;
    };
    const socketUrl = `ws://127.0.0.1:${port}/api/rooms/${code}/ws?token=${token}`;
    const old = new WebSocket(socketUrl, { origin });
    sockets.push(old);
    await once(old, "open");
    assert.equal(service.gateway.connections, 0);
    assert.equal(deadlines.length, 1, "query credentials still need auth");
    const closed = once(old, "close");
    deadlines[0]!();
    assert.equal((await closed)[0], CLOSE_UNAUTHENTICATED);

    // Even with a creator token in the URL, only the frame determines the member's identity.
    const current = new WebSocket(socketUrl, { origin });
    sockets.push(current);
    await once(current, "open");
    const frame = once(current, "message");
    const guestToken = "d".repeat(64);
    current.send(authFrame(guestToken));
    const welcome = JSON.parse(String((await frame)[0])) as {
      type: string;
      id: string;
    };
    assert.equal(welcome.type, "welcome");
    assert.equal(welcome.id, peerId(guestToken));
    assert.notEqual(welcome.id, peerId(token));

    for (const [route, method] of [
      ["ice", "GET"],
      ["end", "POST"],
    ]) {
      const response = await fetch(`${base}/${code}/${route}?token=${token}`, {
        method,
        headers: { Origin: origin },
      });
      assert.equal(response.status, 401, `${route} ignores query credentials`);
    }
    const ice = await fetch(`${base}/${code}/ice`, {
      headers: { Origin: origin, Authorization: `Bearer ${guestToken}` },
    });
    assert.equal(ice.status, 200, "header credentials still work");
    assert.equal(JSON.stringify(logs).includes(token), false);
    assert.equal(JSON.stringify(logs).includes(guestToken), false);
  } finally {
    for (const socket of sockets) socket.terminate();
    await service.close();
  }
});
