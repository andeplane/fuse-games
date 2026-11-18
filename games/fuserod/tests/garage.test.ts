import test from "node:test";
import assert from "node:assert/strict";
import {
  activeCar,
  change,
  FINAL_DAY,
  finished,
  freshCampaign,
  loadCampaign,
  motorSetup,
  purse,
  RIVALS,
  settleRace,
  setup,
  transact,
  type Action,
  type Campaign,
  type Result,
  type StoragePort,
} from "../src/garage/campaign.js";

class Store implements StoragePort {
  values = new Map<string, string>();
  getItem(key: string) {
    return this.values.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
}
function success(r: Result): Campaign {
  assert.ok(r.ok, r.ok ? "" : r.error);
  return r.state;
}
const buy: Action = { type: "buy", model: "kestrel" };
test("a car, fitted parts, gearing and wear feed the race setup", () => {
  const initial = freshCampaign();
  assert.equal(
    change(initial, { type: "race", route: "strip", wager: 0 }).ok,
    false,
  );
  assert.equal(change(initial, { type: "buy", model: "meteor" }).ok, false);
  const s = success(change(initial, buy));
  const tuned = success(
    change(success(change(s, { type: "upgrade", part: "engine" })), {
      type: "upgrade",
      part: "tyres",
    }),
  );
  const geared = success(change(tuned, { type: "gear", gearing: "short" }));
  assert.equal(geared.cash, 25);
  const c = activeCar(geared)!;
  assert.deepEqual(motorSetup(setup(c)), { power: 1, tires: 1, gearbox: 1 });
  assert.equal(motorSetup(setup({ ...c, condition: 30 })).power, 0);
  assert.equal(change(geared, { type: "upgrade", part: "engine" }).ok, false);
  assert.equal(initial.fleet.length, 0);
});
test("resuming a wager reserves cash once; settling pays and advances once", () => {
  const storage = new Store();
  success(transact(storage, buy));
  const entered = success(
    transact(storage, { type: "race", route: "canyon", wager: 300 }),
  );
  assert.deepEqual(loadCampaign(storage), entered);
  assert.equal(entered.cash, 100);
  const ticket = entered.pending!;
  assert.equal(ticket.route, "canyon");
  for (const action of [
    { type: "race", route: "strip", wager: 0 },
    { type: "repair" },
    { type: "restart" },
    { type: "select", model: "kestrel" },
  ] as const)
    assert.equal(transact(storage, action).ok, false);
  assert.equal(settleRace(storage, "wrong", { won: true }).ok, false);
  assert.equal(
    settleRace(storage, ticket.id, { won: true, damage: Infinity }).ok,
    false,
  );
  const winner = success(
    settleRace(storage, ticket.id, { won: true, damage: 12 }),
  );
  assert.equal(winner.cash, 100 + 600 + purse(0));
  assert.equal(winner.day, 2);
  assert.equal(winner.rank, 1);
  assert.equal(activeCar(winner)?.condition, 82);
  assert.equal(winner.pending, null);
  assert.equal(settleRace(storage, ticket.id, { won: true }).ok, false);
  const repaired = success(transact(storage, { type: "repair" }));
  assert.equal(repaired.cash, winner.cash - 54);
  assert.equal(activeCar(repaired)?.condition, 100);
  const repeat = success(
    transact(storage, { type: "race", route: "strip", rivalRank: 0, wager: 0 }),
  );
  const rematch = success(
    settleRace(storage, repeat.pending!.id, { won: true }),
  );
  assert.equal(rematch.rank, 1);
  assert.equal(rematch.day, 3);
});
test("cars retain their workshop configurations when switched", () => {
  let s = success(change(freshCampaign(), buy));
  s = success(change(s, { type: "gear", gearing: "tall" }));
  for (let n = 0; n < 3; n++) {
    s = success(change(s, { type: "race", route: "strip", wager: 300 }));
    s = success(
      change(s, { type: "settle", id: s.pending!.id, won: true, damage: 0 }),
    );
  }
  s = success(change(s, { type: "buy", model: "marlin" }));
  assert.equal(activeCar(s)?.gearing, "street");
  s = success(change(s, { type: "select", model: "kestrel" }));
  assert.equal(activeCar(s)?.gearing, "tall");
});
test("winning the ladder or running down the calendar closes a season", () => {
  for (const won of [true, false]) {
    let s = success(change(freshCampaign(), buy));
    for (let i = 0; i < (won ? 12 : FINAL_DAY); i++) {
      if (activeCar(s)!.fuel < 40) s = success(change(s, { type: "refuel" }));
      if (won && i === 2) {
        s = success(change(s, { type: "grudge" }));
        for (let heat = 0; heat <= 4; heat++) {
          assert.equal(s.pending?.heat, heat);
          s = success(
            change(s, {
              type: "settle",
              id: s.pending!.id,
              won: true,
              damage: 0,
              elapsedTicks: 330,
            }),
          );
        }
        assert.equal(s.qualified, true);
      }
      s = success(
        change(s, {
          type: "race",
          route: i % 2 ? "aqueduct" : "canyon",
          wager: 0,
        }),
      );
      s = success(
        change(s, { type: "settle", id: s.pending!.id, won, damage: 0 }),
      );
    }
    if (won) {
      if (activeCar(s)!.fuel < 36) s = success(change(s, { type: "refuel" }));
      s = success(
        change(s, { type: "race", route: "strip", wager: 0, rivalRank: 4 }),
      );
      for (const route of ["strip", "canyon", "aqueduct"]) {
        assert.ok(s.pending?.king);
        assert.equal(s.pending.route, route);
        assert.equal(
          s.pending.stakeKind,
          route === "aqueduct" ? "title" : "cash",
        );
        s = success(
          change(s, { type: "settle", id: s.pending.id, won: true, damage: 0 }),
        );
      }
    }
    assert.ok(finished(s));
    assert.equal(s.rank, won ? RIVALS.length : 0);
    assert.equal(
      change(s, { type: "race", route: "strip", wager: 0 }).ok,
      false,
    );
    const reset = success(change(s, { type: "restart" }));
    assert.equal(reset.next, s.next);
    assert.equal(reset.day, 1);
    assert.equal(reset.fleet.length, 0);
  }
});
test("car title stakes transfer ownership, settle a duplicate or end a broke season", () => {
  let s = success(change(freshCampaign(), buy));
  const title = (state: Campaign, won: boolean) => {
    const joined = success(
      change(state, {
        type: "race",
        route: "canyon",
        wager: 0,
        pinkSlip: true,
      }),
    );
    return success(
      change(joined, {
        type: "settle",
        id: joined.pending!.id,
        won,
        damage: 0,
      }),
    );
  };
  const lost = title(s, false);
  assert.ok(finished(lost));
  assert.equal(lost.selected, null);
  s = title(s, true);
  assert.equal(s.cash, 750);
  assert.equal(s.fleet.length, 1);
  s = title(s, true);
  assert.deepEqual(
    s.fleet.map((c) => c.model),
    ["kestrel", "marlin"],
  );
  s = success(change(s, { type: "refuel" }));
  s = title(s, false);
  assert.equal(s.selected, "marlin");
  assert.equal(finished(s), false);
});
test("Wednesday bracket tickets survive reloads without double entry fees or heat rewards", () => {
  const storage = new Store();
  success(transact(storage, buy));
  assert.equal(transact(storage, { type: "grudge" }).ok, false);
  let s = success(transact(storage, { type: "wait" }));
  assert.equal(s.day, 3);
  s = success(transact(storage, { type: "grudge" }));
  assert.equal(s.cash, 370);
  for (let heat = 0; heat <= 4; heat++) {
    const before = loadCampaign(storage);
    assert.deepEqual(before, s);
    assert.equal(before.pending!.heat, heat);
    assert.equal(before.day, 3);
    assert.equal(before.pending!.route, "strip");
    assert.equal(before.pending!.variant, heat === 0 ? "timed" : "grudge");
    assert.equal(before.pending!.dialInTicks, heat === 0 ? 0 : 320);
    if (heat === 0)
      assert.equal(
        settleRace(storage, before.pending!.id, { won: true }).ok,
        false,
      );
    s = success(
      settleRace(storage, before.pending!.id, {
        won: true,
        elapsedTicks: 320 + heat,
      }),
    );
    assert.equal(
      settleRace(storage, before.pending!.id, { won: true }).ok,
      false,
    );
  }
  assert.equal(s.day, 4);
  assert.equal(s.cash, 820);
  assert.equal(s.qualified, true);
  assert.equal(s.rank, 0);
  assert.equal(s.pending, null);
});
test("a breakout eliminates the driver even when the finish line was crossed first", () => {
  const storage = new Store();
  success(transact(storage, buy));
  success(transact(storage, { type: "wait" }));
  const time = success(transact(storage, { type: "grudge" }));
  const heat = success(
    settleRace(storage, time.pending!.id, { won: true, elapsedTicks: 375 }),
  );
  const walkover = success(
    settleRace(storage, heat.pending!.id, { won: true }),
  );
  assert.equal(walkover.pending?.heat, 2);
  const breakout = success(
    settleRace(storage, walkover.pending!.id, {
      won: false,
      elapsedTicks: 374,
    }),
  );
  assert.equal(breakout.pending, null);
  assert.match(breakout.receipt, /Breakout/);
  assert.equal(breakout.cash, 370);
});
test("fuel is reserved once per ticket and the pump, paint and resale follow the selected car", () => {
  const storage = new Store();
  success(transact(storage, buy));
  const paint = success(transact(storage, { type: "paint", paint: "#738bdd" }));
  assert.equal(paint.cash, 380);
  let s = success(
    transact(storage, { type: "race", route: "canyon", wager: 0 }),
  );
  assert.equal(s.pending!.car.paint, "#738bdd");
  assert.equal(activeCar(s)!.fuel, 23);
  assert.equal(activeCar(loadCampaign(storage))!.fuel, 23);
  s = success(settleRace(storage, s.pending!.id, { won: false }));
  s = success(transact(storage, { type: "race", route: "canyon", wager: 0 }));
  s = success(settleRace(storage, s.pending!.id, { won: false }));
  assert.equal(
    transact(storage, { type: "race", route: "strip", wager: 0 }).ok,
    false,
  );
  s = success(transact(storage, { type: "refuel" }));
  assert.equal(activeCar(s)!.fuel, 170);
  assert.equal(s.cash, 361);
  assert.equal(transact(storage, { type: "refuel" }).ok, false);
  s = success(transact(storage, { type: "sell", model: "kestrel" }));
  assert.equal(s.fleet.length, 0);
  assert.equal(s.selected, null);
});
test("Redline requires the four earlier rivals and a Grudge Night win", () => {
  let s = success(change(freshCampaign(), buy));
  for (let i = 0; i < 4; i++) {
    s = success(change(s, { type: "race", route: "strip", wager: 0 }));
    s = success(
      change(s, { type: "settle", id: s.pending!.id, won: true, damage: 0 }),
    );
  }
  assert.equal(
    change(s, { type: "race", route: "strip", wager: 0, rivalRank: 4 }).ok,
    false,
  );
  s = success(change(s, { type: "wait" }));
  s = success(change(s, { type: "refuel" }));
  s = success(change(s, { type: "grudge" }));
  const eliminated = success(
    change(s, { type: "settle", id: s.pending!.id, won: false, damage: 0 }),
  );
  assert.equal(eliminated.qualified, false);
  assert.equal(eliminated.pending, null);
});
test("corrupt saves and failed writes cannot open or pay a race", () => {
  const storage = new Store();
  const s = success(transact(storage, buy));
  const [key] = storage.values.keys();
  for (const bad of [
    { ...s, selected: "meteor" },
    { ...s, cash: -1 },
    { ...s, fleet: [...s.fleet, ...s.fleet] },
    {
      ...s,
      pending: { id: "race-1", wager: 0, route: "constructor", rivalRank: 0 },
    },
  ]) {
    const raw = JSON.stringify(bad);
    storage.setItem(key!, raw);
    assert.throws(() => loadCampaign(storage));
    assert.equal(transact(storage, { type: "repair" }).ok, false);
    assert.equal(storage.getItem(key!), raw);
  }
  const refused: StoragePort = {
    getItem: () => null,
    setItem: () => {
      throw new Error("Storage full");
    },
  };
  assert.deepEqual(transact(refused, buy), {
    ok: false,
    error: "Storage full",
  });
});
