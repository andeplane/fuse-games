import test from "node:test";
import assert from "node:assert/strict";
import type {
  RoomTransport,
  RuntimeDependencies,
  TransportEvents,
} from "fuse-netcode";
import { FuserodRuntime } from "../src/app/runtime.js";
import { DEFAULT_SETTINGS } from "../src/game/index.js";

class TestRuntime extends FuserodRuntime {
  state() {
    return this.world?.state;
  }
  hashAt(tick: number) {
    return this.world?.hashAt(tick);
  }
}
/** Deterministic clock/transport. Reliable messages are ordered; fast packets can be lost,
 * reordered and duplicated. Receiver fencing models replacement RTC links after reload. */
class Mesh {
  now = 0;
  private order = 0;
  private generations = new Map<string, number>();
  private loops = new Map<string, () => void>();
  private events = new Map<string, TransportEvents>();
  private online = new Set<string>();
  private hidden = new Set<string>();
  private visibility = new Map<string, () => void>();
  private queue: { at: number; order: number; run(): void }[] = [];
  impair = false;
  corrupt = false;
  snapshots = 0;
  packets = 0;
  statuses: string[] = [];
  private at(delay: number, run: () => void) {
    this.queue.push({ at: this.now + delay, order: this.order++, run });
  }
  join(id: string, displayOnly = false): TestRuntime {
    const generation = (this.generations.get(id) ?? 0) + 1;
    this.generations.set(id, generation);
    const dependencies: RuntimeDependencies = {
      now: () => this.now,
      hidden: () => this.hidden.has(id),
      token: () => `match-${this.order++}`,
      generation: () => generation,
      schedule: (cb) => {
        this.loops.set(id, cb);
        return () => {
          this.loops.delete(id);
        };
      },
      onVisibilityChange: (cb) => {
        this.visibility.set(id, cb);
        return () => {
          this.visibility.delete(id);
        };
      },
    };
    const runtime = new TestRuntime(
      "AB42AA",
      { ...DEFAULT_SETTINGS, display: true },
      {
        ready() {},
        state() {},
        event() {},
        status: (s) => this.statuses.push(s),
      },
      {
        dependencies,
        displayOnly,
        transport: (events) => {
          this.events.set(id, events);
          const transport: RoomTransport = {
            id,
            hostId: "a",
            sentBytes: 0,
            connect: () => {
              this.online.add(id);
              this.at(0, () => {
                events.welcome(id, "a");
                for (const other of this.online)
                  if (other !== id) {
                    events.peer(other, true);
                    this.events.get(other)!.peer(id, true);
                    events.link(other, true);
                    this.events.get(other)!.link(id, true);
                  }
              });
            },
            close: () => this.leave(id),
            linked: (to) => this.online.has(id) && this.online.has(to),
            explain: () => "test direct link",
            stats: async () => ({ direct: 1, relayed: 0, buffered: 0 }),
            send: (to, data) => {
              if (!this.online.has(id) || !this.online.has(to)) return false;
              const copy: unknown = structuredClone(data);
              if (
                copy &&
                typeof copy === "object" &&
                "type" in copy &&
                copy.type === "snapshot"
              ) {
                this.snapshots++;
                if (this.corrupt && "data" in copy) copy.data = "!corrupt";
              }
              const receiver = this.events.get(to)!;
              this.at(15, () => {
                if (this.online.has(to) && this.events.get(to) === receiver)
                  receiver.message(id, copy);
              });
              return true;
            },
            sendFast: (to, bytes) => {
              if (!this.online.has(id) || !this.online.has(to)) return false;
              const packet = ++this.packets,
                receiver = this.events.get(to)!,
                copy = bytes.slice();
              if (this.impair && packet % 5 === 0) return true;
              const deliver = () => {
                if (this.online.has(to) && this.events.get(to) === receiver)
                  receiver.fast(id, copy);
              };
              this.at(this.impair ? 20 + (packet % 4) * 40 : 20, deliver);
              if (this.impair && packet % 3 === 0) this.at(80, deliver);
              return true;
            },
          };
          return transport;
        },
      },
    );
    runtime.start();
    return runtime;
  }
  leave(id: string) {
    if (!this.online.delete(id)) return;
    this.loops.delete(id);
    for (const other of this.online)
      this.at(0, () => this.events.get(other)?.peer(id, false));
  }
  hide(id: string, value: boolean) {
    if (value) this.hidden.add(id);
    else this.hidden.delete(id);
    this.visibility.get(id)?.();
  }
  run(ms: number) {
    const end = this.now + ms;
    const flush = () => {
      for (;;) {
        this.queue.sort((a, b) => a.at - b.at || a.order - b.order);
        if (!this.queue[0] || this.queue[0].at > this.now) break;
        this.queue.shift()!.run();
      }
    };
    while (this.now < end) {
      this.now += 10;
      flush();
      for (const loop of [...this.loops.values()]) loop();
      flush();
    }
  }
}
function started() {
  const mesh = new Mesh(),
    a = mesh.join("a"),
    b = mesh.join("b"),
    tv = mesh.join("tv", true);
  mesh.run(200);
  a.command({ type: "join", name: "Alice" });
  b.command({ type: "join", name: "Bob" });
  mesh.run(3000);
  assert.equal(tv.command({ type: "join", name: "TV" }), false);
  assert.equal(b.command({ type: "action", action: "start" }), false);
  assert.equal(a.command({ type: "action", action: "start" }), true);
  mesh.run(300);
  for (const r of [a, b, tv]) assert.equal(r.state()?.stage, "running");
  assert.equal(tv.state()?.seats.size, 2);
  return { mesh, a, b, tv };
}
function converge(runtimes: TestRuntime[]) {
  const at = Math.floor((Math.min(...runtimes.map((r) => r.tick)) - 8) / 4) * 4;
  const hashes = runtimes.map((r) => r.hashAt(at));
  assert.ok(hashes[0], `retained common tick ${at}`);
  assert.ok(
    hashes.every((h) => h === hashes[0]),
    `replicas agree at ${at}: ${hashes}`,
  );
}

test("two drivers and a TV recover the same racing state through packet loss, cancellation and reconnect", () => {
  const { mesh, a, b, tv } = started();
  mesh.impair = true;
  const launch = { throttle: true, brake: false, steer: 0, shift: 1 } as const;
  assert.equal(tv.input(launch), false);
  assert.equal(a.input(launch), true);
  assert.equal(b.input(launch), true);
  mesh.run(3500);
  for (let i = 0; i < 10; i++) {
    b.input({ ...launch, shift: 0, steer: i % 2 ? 1 : -1 });
    mesh.run(120);
  }
  b.cancel();
  mesh.impair = false;
  mesh.run(1500);
  assert.ok(a.state()!.race!.racers.every((r) => r.motor.position > 0));
  assert.equal(a.state()!.race!.racers[1]!.input.throttle, false);
  converge([a, b, tv]);
  const match = a.state()!.matchId;
  b.stop();
  mesh.run(1000);
  mesh.corrupt = true;
  const replacement = mesh.join("b");
  mesh.run(800);
  assert.equal(replacement.state(), undefined);
  mesh.corrupt = false;
  mesh.run(6500);
  assert.equal(replacement.state()?.matchId, match);
  assert.equal(replacement.state()?.seats.get("b")?.generation, 2);
  assert.ok(mesh.snapshots > 0);
  converge([a, replacement, tv]);
});
