import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { type AddressInfo } from "node:net";
import { WebSocket } from "ws";
import { authFrame } from "fuse-network-protocol";
import { RoomGateway, type GatewaySocket } from "../src/gateway.js";
import { createRoomServer } from "../src/http.js";
import { LocalRoomBus, MemoryRoomDatabase } from "../src/memory-database.js";
import { RoomStore } from "../src/room-store.js";
import {
  MAX_ADMITTED_SOCKETS,
  MAX_PENDING_ADMISSIONS,
  MAX_SOCKETS_PER_ADDRESS,
} from "../src/socket-capacity.js";

const socket = (): GatewaySocket => ({
  send() {},
  close() {},
  bufferedAmount: 0,
});

test("F-01 caps each address and the instance, releases capacity, and keeps HTTP available", async () => {
  const store = new RoomStore(new MemoryRoomDatabase(), {
    now: Date.now,
    id: randomUUID,
  });
  const gateway = new RoomGateway("test", store, new LocalRoomBus(), {
    now: Date.now,
    id: randomUUID,
    error: () => {},
    schedule: () => () => {},
  });
  const server = createRoomServer({
    store,
    gateway,
    now: Date.now,
    allowOrigin: () => true,
    clientAddress: () => "http-client",
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const connect = async (address: string) => {
    const token = randomBytes(32).toString("hex");
    const code = await store.createAvailable(token);
    return gateway.connect(
      code,
      token,
      socket(),
      undefined,
      undefined,
      address,
    );
  };
  try {
    const ids = [];
    for (let i = 0; i < MAX_SOCKETS_PER_ADDRESS; i++)
      ids.push(await connect("shared"));
    await assert.rejects(connect("shared"), /Socket capacity reached/);
    ids.push(await connect("another"));
    for (let i = ids.length; i < MAX_ADMITTED_SOCKETS; i++)
      ids.push(await connect(`address-${i}`));
    await assert.rejects(connect("fresh"), /Socket capacity reached/);
    assert.equal((await fetch(`${url}/api/health`)).status, 200);
    assert.equal(
      (await fetch(`${url}/api/rooms`, { method: "POST" })).status,
      201,
    );
    const ready = (await (await fetch(`${url}/api/ready`)).json()) as {
      socketCapacity: {
        admitted: number;
        limit: number;
        maxAddressUsage: number;
      };
    };
    assert.deepEqual(
      [
        ready.socketCapacity.admitted,
        ready.socketCapacity.limit,
        ready.socketCapacity.maxAddressUsage,
      ],
      [MAX_ADMITTED_SOCKETS, MAX_ADMITTED_SOCKETS, MAX_SOCKETS_PER_ADDRESS],
    );
    await gateway.disconnect(ids[0]!);
    await connect("shared");
    assert.equal(gateway.capacity.reserved, MAX_ADMITTED_SOCKETS);
    await gateway.disconnect(ids[1]!);
    await assert.rejects(
      gateway.connect(
        "ZZZZ",
        "a".repeat(64),
        socket(),
        undefined,
        undefined,
        "fresh",
      ),
    );
    assert.equal(gateway.capacity.reserved, MAX_ADMITTED_SOCKETS - 1);
  } finally {
    await gateway.stop();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});

test("F-01 a socket rejected at address capacity receives retryable close 1013", async () => {
  const store = new RoomStore(new MemoryRoomDatabase(), {
    now: Date.now,
    id: randomUUID,
  });
  const gateway = new RoomGateway("test", store, new LocalRoomBus(), {
    now: Date.now,
    id: randomUUID,
    error: () => {},
    schedule: () => () => {},
  });
  const server = createRoomServer({
    store,
    gateway,
    now: Date.now,
    allowOrigin: () => true,
    clientAddress: () => "shared",
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    for (let i = 0; i < MAX_SOCKETS_PER_ADDRESS; i++) {
      const token = randomBytes(32).toString("hex");
      const code = await store.createAvailable(token);
      await gateway.connect(
        code,
        token,
        socket(),
        undefined,
        undefined,
        "shared",
      );
    }
    const token = randomBytes(32).toString("hex");
    const code = await store.createAvailable(token);
    const peer = new WebSocket(
      `ws://127.0.0.1:${(server.address() as AddressInfo).port}/api/rooms/${code}/ws`,
      { origin: "https://example.com" },
    );
    peer.once("open", () => peer.send(authFrame(token)));
    const closeCode = await new Promise<number>((resolve, reject) => {
      peer.once("close", resolve);
      peer.once("error", reject);
    });
    assert.equal(closeCode, 1013);
  } finally {
    await gateway.stop();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});

test("F-01 capacity remains reserved until the underlying socket closes", async () => {
  const store = new RoomStore(new MemoryRoomDatabase(), {
    now: Date.now,
    id: randomUUID,
  });
  const gateway = new RoomGateway("test", store, new LocalRoomBus(), {
    now: Date.now,
    id: randomUUID,
    error: () => {},
    schedule: () => () => {},
  });
  let close = () => {};
  const untilClosed = new Promise<void>((resolve) => {
    close = resolve;
  });
  const token = randomBytes(32).toString("hex");
  const code = await store.createAvailable(token);
  const id = await gateway.connect(
    code,
    token,
    socket(),
    undefined,
    undefined,
    "address",
    untilClosed,
  );
  await gateway.disconnect(id);
  assert.equal(gateway.connections, 0);
  assert.equal(gateway.capacity.reserved, 1);
  close();
  await untilClosed;
  assert.equal(gateway.capacity.reserved, 0);
  await gateway.stop();
});

test("F-01 deploy concurrency reserves room for sockets, pending admissions and HTTP", async () => {
  const script = await readFile("scripts/deploy-cloud.sh", "utf8");
  const concurrency = Number(script.match(/--concurrency=(\d+)/)?.[1]);
  const instances = Number(script.match(/--max-instances=(\d+)/)?.[1]);
  assert.equal(instances, 2);
  assert.equal(concurrency, 80);
  assert.equal(MAX_ADMITTED_SOCKETS, 60);
  assert.equal(MAX_PENDING_ADMISSIONS, 16);
  assert.ok(MAX_ADMITTED_SOCKETS + MAX_PENDING_ADMISSIONS < concurrency);
  assert.ok(MAX_PENDING_ADMISSIONS < concurrency);
  assert.ok(instances * MAX_ADMITTED_SOCKETS >= 8 * 14);
});
