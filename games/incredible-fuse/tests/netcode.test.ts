import test from "node:test";
import assert from "node:assert/strict";
import {
  ACTION,
  JOIN,
  PRESENCE,
  SPECTATOR,
  SnapshotAssembler,
  World,
  decodeSnapshot,
  encodeSnapshot,
} from "fuse-netcode";
import {
  EDIT,
  DEFAULT_SETTINGS,
  createRoom,
  decodeRoom,
  encodeRoom,
  hashRoom,
  incredibleFuseGame,
  isIncredibleFuseEntry,
} from "../src/game/index.js";
import { IncredibleFuseMesh } from "./fixtures/mesh.js";

function replica() {
  const w = new World(
    incredibleFuseGame,
    createRoom("lobby", DEFAULT_SETTINGS),
    "host",
    "host",
  );
  const host = w.stream("host", 1);
  w.stream("guest", 2);
  host.append(1, [JOIN, "guest", "Ada", 0, "cat", 2]);
  host.append(2, [ACTION, "start", "first"]);
  host.through = 200;
  return w;
}
const ramp = { type: "place", kind: "ramp", x: 200, y: 180 } as const;
test("a delayed placement rolls the live machine back before its run; a checkpoint continues the corrected flight", () => {
  const early = replica(),
    late = replica();
  const place = [1, 4, EDIT, "first", 1, ramp] as const;
  const start = [2, 8, EDIT, "first", 1, { type: "run" }] as const;
  early.receive("guest", [[...place], [...start]], 2, 28, 28);
  early.advance(28);
  late.advance(13);
  assert.ok(late.state.machine.parts.every((p) => p.fixed));
  late.receive("guest", [[...start]], 2, 28, 28);
  const repaired = late.receive("guest", [[...place], [...start]], 2, 28, 28);
  assert.ok(repaired.rollbackTicks > 0);
  late.advance(28);
  assert.equal(hashRoom(late.state), hashRoom(early.state));
  assert.ok(late.state.machine.parts.some((p) => !p.fixed));
  const assembler = new SnapshotAssembler(incredibleFuseGame, 17);
  const completed = encodeSnapshot(late, 17)
    .map((chunk) => assembler.accept(chunk))
    .at(-1);
  assert.ok(completed);
  const decoded = decodeSnapshot(incredibleFuseGame, completed.bytes, 17);
  assert.ok(decoded);
  assert.equal(hashRoom(decoded.state), hashRoom(late.servable().state));
  const resumed = replica();
  resumed.install(decoded.state);
  early.advance(36);
  resumed.advance(36);
  assert.equal(hashRoom(resumed.state), hashRoom(early.state));
});
test("stale match, watcher and retired-generation edits are ignored", () => {
  const w = replica();
  const host = w.stream("host", 1);
  host.append(3, [SPECTATOR, "join", "tv", "TV", 1]);
  const tv = w.stream("tv", 1);
  tv.append(4, [EDIT, "first", 1, ramp]);
  const guest = w.stream("guest", 2);
  guest.append(4, [EDIT, "previous", 1, ramp]);
  guest.append(6, [EDIT, "first", 1, ramp]);
  host.append(5, [PRESENCE, "guest", true, 3]);
  w.stream("guest", 3);
  w.advance(8);
  assert.ok(w.state.machine.parts.every((p) => p.fixed));
  assert.equal(isIncredibleFuseEntry([1, 9, EDIT, "first", 2, ramp]), false);
});
test("decode rejects invalid placements and conflicting seats and preserves away seats", () => {
  const w = replica();
  w.stream("guest", 2).append(3, [PRESENCE, "guest", false, 2]);
  w.advance(4);
  const f = encodeRoom(w.state);
  assert.equal(decodeRoom(f, 4)?.seats.get("guest")?.away, true);
  const duplicate = structuredClone(f);
  duplicate[4] = [...w.state.seats.values(), ...w.state.seats.values()];
  assert.equal(decodeRoom(duplicate, 4), undefined);
  const invalid = structuredClone(f);
  invalid[5] = { ...w.state.machine, puzzle: -1 };
  assert.equal(decodeRoom(invalid, 4), undefined);
  assert.equal(hashRoom(decodeRoom(f, 4)!), hashRoom(w.state));
});
test("two builders and a read-only peer converge after impaired edits, undo and reconnect", () => {
  const mesh = new IncredibleFuseMesh("host", DEFAULT_SETTINGS);
  const host = mesh.join("host"),
    guest = mesh.join("guest"),
    tv = mesh.join("tv");
  mesh.run(600);
  host.command({ type: "join", name: "Ada" });
  guest.command({ type: "join", name: "Ben" });
  mesh.run(1800);
  assert.equal(host.command({ type: "action", action: "start" }), true);
  mesh.run(500);
  assert.equal(tv.play(ramp), false);
  let n = 0;
  mesh.fast = () => {
    n++;
    return n % 4 === 0
      ? { drop: true }
      : { delayMs: n % 3 === 0 ? 95 : 10, duplicateMs: 120 };
  };
  assert.equal(guest.play(ramp), true);
  mesh.run(700);
  for (const r of [host, guest, tv])
    assert.ok(r.roomState()?.machine.parts.some((p) => !p.fixed));
  assert.equal(host.play({ type: "undo" }), true);
  mesh.run(1200);
  assert.equal(
    host.roomState()?.machine.parts.some((p) => !p.fixed),
    false,
  );
  mesh.leave("tv");
  guest.play(ramp);
  mesh.run(600);
  const returning = mesh.join("tv");
  mesh.run(3000);
  const all = [host, guest, returning];
  const tick =
    Math.floor((Math.min(...all.map((r) => r.roomState()!.tick)) - 8) / 4) * 4;
  const hash = host.hashAt(tick);
  assert.ok(hash);
  for (const r of all) assert.equal(r.hashAt(tick), hash);
});
