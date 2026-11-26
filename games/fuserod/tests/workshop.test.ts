import test from "node:test";
import assert from "node:assert/strict";
import { carbCount } from "../src/workshop/mechanics.js";
import {
  STATIONS,
  GRADES,
  STATION,
  freshWorkshop,
  inspectWorkshop,
  isWorkshop,
  workshopAction,
  price,
  stockIndex,
  type WorkshopCommand,
} from "../src/workshop/mechanics.js";
function bench() {
  let state = freshWorkshop(),
    cash = 1000;
  return {
    state: () => state,
    cash: () => cash,
    apply(cmd: WorkshopCommand) {
      const result = workshopAction(state, cmd, cash);
      if (result.ok) {
        state = result.workshop;
        cash = result.cash;
      }
      return result;
    },
  };
}
test("a triple-carb intake requires three separately fitted and secured carburettors", () => {
  const b = bench();
  const turn = (
    s: "intake" | "carb",
    index: number,
    delta: -1 | 1,
    n: number,
    port = 0,
  ) => {
    for (let i = 0; i < n; i++)
      assert(b.apply({ type: "bolt", station: s, index, delta, port }).ok);
  };
  turn("carb", 0, -1, 3);
  assert(b.apply({ type: "remove", station: "carb" }).ok);
  for (const i of [0, 1]) turn("intake", i, -1, 3);
  assert(b.apply({ type: "remove", station: "intake" }).ok);
  assert(b.apply({ type: "buy", station: "intake", grade: 2 }).ok);
  assert(b.apply({ type: "fit", station: "intake", grade: 2 }).ok);
  for (const i of [0, 1]) turn("intake", i, 1, 2);
  assert.equal(carbCount(b.state()), 3);
  for (let port = 0; port < 3; port++) {
    assert(!inspectWorkshop(b.state()).ready);
    if (port) assert(b.apply({ type: "buy", station: "carb", grade: 0 }).ok);
    assert(b.apply({ type: "fit", station: "carb", grade: 0, port }).ok);
    turn("carb", 0, 1, 2, port);
  }
  assert.equal(inspectWorkshop(b.state()).ready, true);
  assert.equal(isWorkshop(JSON.parse(JSON.stringify(b.state()))), true);
  assert(!b.apply({ type: "bolt", station: "intake", index: 0, delta: -1 }).ok);
});
test("all 64 named parts have a price and a unique shelf position", () => {
  const names = new Set<string>(),
    parts = new Set<number>();
  for (const s of STATIONS)
    for (const grade of GRADES) {
      names.add(STATION[s].models[grade]);
      parts.add(stockIndex(s, grade));
      assert(price(s, grade) > 0);
    }
  assert.equal(names.size, 64);
  assert.equal(parts.size, 64);
  assert.equal(inspectWorkshop(freshWorkshop()).ready, true);
});
test("an intake cannot be freed with its carb still attached; loose carb bolts prevent racing", () => {
  const b = bench();
  assert.equal(
    b.apply({ type: "bolt", station: "intake", index: 0, delta: -1 }).ok,
    false,
  );
  assert.equal(b.apply({ type: "remove", station: "carb" }).ok, false);
  for (let i = 0; i < 3; i++)
    assert(b.apply({ type: "bolt", station: "carb", index: 0, delta: -1 }).ok);
  assert(!inspectWorkshop(b.state()).ready);
  assert(b.apply({ type: "remove", station: "carb" }).ok);
  assert.equal(b.state().spares[stockIndex("carb", 0)], 1);
  assert(b.apply({ type: "buy", station: "carb", grade: 5 }).ok);
  assert.equal(b.apply({ type: "fit", station: "carb", grade: 5 }).ok, false);
  assert(b.apply({ type: "fit", station: "carb", grade: 0 }).ok);
  assert.deepEqual(b.state().mounts.carb.bolts, [1]);
  for (let i = 0; i < 2; i++)
    assert(b.apply({ type: "bolt", station: "carb", index: 0, delta: 1 }).ok);
  assert(inspectWorkshop(b.state()).ready);
});
test("jack and both bellhousing mount points govern the transmission swap", () => {
  const b = bench();
  assert(
    !b.apply({ type: "bolt", station: "gearbox", index: 0, delta: -1 }).ok,
  );
  b.apply({ type: "jack" });
  assert(!inspectWorkshop(b.state()).ready);
  for (const index of [0, 1])
    for (let i = 0; i < 3; i++)
      assert(
        b.apply({ type: "bolt", station: "gearbox", index, delta: -1 }).ok,
      );
  b.apply({ type: "remove", station: "gearbox" });
  b.apply({ type: "buy", station: "gearbox", grade: 2 });
  b.apply({ type: "fit", station: "gearbox", grade: 2 });
  for (const index of [0, 1])
    for (let i = 0; i < 2; i++)
      b.apply({ type: "bolt", station: "gearbox", index, delta: 1 });
  b.apply({ type: "jack" });
  const report = inspectWorkshop(b.state());
  assert(report.automatic);
  assert(report.ready);
  assert(isWorkshop(b.state()));
});
test("disconnected ignition and loose parts persist; failed work leaves the wallet and assembly untouched", () => {
  const b = bench();
  b.apply({ type: "wire" });
  const before = structuredClone(b.state());
  assert(!b.apply({ type: "timing", delta: 1 }).ok);
  assert.deepEqual(b.state(), before);
  const save = JSON.parse(JSON.stringify(before));
  assert(isWorkshop(save));
  assert(!inspectWorkshop(save).ready);
  save.mounts.engine.bolts[0] = 4;
  assert(!isWorkshop(save));
  const receipt = b.apply({ type: "buy", station: "header", grade: 1 });
  assert(receipt.ok);
  assert(b.cash() < 1000);
  assert(b.apply({ type: "sell", station: "header", grade: 1 }).ok);
  assert(b.cash() < 1000);
  assert(!b.apply({ type: "sell", station: "header", grade: 1 }).ok);
  b.apply({ type: "wire" });
  b.apply({ type: "timing", delta: 1 });
  assert.equal(inspectWorkshop(b.state()).hp, -4);
});
