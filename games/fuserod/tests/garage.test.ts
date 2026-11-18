import test from "node:test";
import assert from "node:assert/strict";
import { saveSlot, restoreSlot, slotSummary } from "../src/garage/slots.js";
import {
  activeCar,
  dealerQuote,
  rivalAccepts,
  change as reduce,
  FINAL_DAY,
  finished,
  freshCampaign,
  loadCampaign,
  listings,
  MODELS,
  FLEET_CAPACITY,
  MODEL_IDS,
  undoWorkshop,
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
const fixtureAttempt = "00000000-0000-4000-8000-000000000001";
function change(state: Campaign, action: Action): Result {
  return reduce(
    state,
    action.type === "race" || action.type === "grudge"
      ? { ...action, attemptId: fixtureAttempt }
      : action,
  );
}
function success(r: Result): Campaign {
  assert.ok(r.ok, r.ok ? "" : r.error);
  return r.state;
}
const buy: Action = { type: "buy", model: "kestrel" };
test("restoring the same slot sequence in diverging tabs issues distinct wagers and rejects the older finisher", () => {
  const older = new Store();
  success(transact(older, buy));
  success(saveSlot(older, 1, false));
  const newer = new Store();
  newer.values = new Map(older.values);
  success(restoreSlot(older, 1, "current"));
  success(restoreSlot(newer, 1, "current"));
  const previous = success(
    transact(
      older,
      { type: "race", route: "strip", wager: 0 },
      () => fixtureAttempt,
    ),
  );
  const current = success(
    transact(
      newer,
      { type: "race", route: "aqueduct", wager: 100 },
      () => "00000000-0000-4000-8000-000000000002",
    ),
  );
  assert.equal(previous.next, current.next);
  assert.notEqual(previous.pending!.id, current.pending!.id);
  assert.deepEqual(loadCampaign(newer).pending, current.pending);
  assert.equal(
    settleRace(newer, current.pending!.id, { won: false, speedingMph: 81 }).ok,
    false,
  );
  assert.equal(
    settleRace(newer, previous.pending!.id, { won: true }).ok,
    false,
  );
  assert.deepEqual(loadCampaign(newer), current);
  const legacy = JSON.parse(JSON.stringify(previous));
  delete legacy.pending.attemptId;
  legacy.pending.id = `race-${legacy.next}`;
  older.setItem("fuserod.garage.v1", JSON.stringify(legacy));
  assert.equal(loadCampaign(older).pending!.id, legacy.pending.id);
  success(settleRace(older, legacy.pending.id, { won: true }));
});
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
test("weekly classifieds cover 22 distinct bodies and cap the working fleet at sixteen", () => {
  assert.equal(MODEL_IDS.length, 22);
  assert.equal(new Set(MODEL_IDS.map((id) => MODELS[id].sprite)).size, 22);
  const offered = new Set([...listings(1), ...listings(8), ...listings(15)]);
  assert.equal(offered.size, 22);
  const storage = new Store();
  // A funded garage exercises the full fleet without coupling this check to an entire season of wins.
  storage.setItem(
    "fuserod.garage.v1",
    JSON.stringify({ ...freshCampaign(), cash: 100000 }),
  );
  for (const model of listings(1))
    success(transact(storage, { type: "buy", model }));
  success(transact(storage, { type: "newspaper" }));
  const nextModel = listings(8).find((id) => !listings(1).includes(id))!;
  success(transact(storage, { type: "buy", model: nextModel }));
  const fleet = loadCampaign(storage);
  assert.equal(fleet.fleet.length, FLEET_CAPACITY);
  assert.equal(fleet.day, 8);
  assert.equal(setup(activeCar(fleet)!).modelIndex, MODELS[nextModel].sprite);
  const another = listings(8).find(
    (id) => !fleet.fleet.some((v) => v.model === id),
  )!;
  assert.equal(transact(storage, { type: "buy", model: another }).ok, false);
});
test("a car carries its bench, readiness and bodywork through save, undo and races", () => {
  const storage = new Store();
  success(transact(storage, buy));
  const prior = loadCampaign(storage);
  const opened = success(
    transact(storage, { type: "workbench", command: { type: "jack" } }),
  );
  assert.equal(
    transact(storage, { type: "race", route: "strip", wager: 0 }).ok,
    false,
  );
  assert.equal(activeCar(loadCampaign(storage))?.workshop.jacked, true);
  success(undoWorkshop(storage, prior, opened));
  assert.equal(activeCar(loadCampaign(storage))?.workshop.jacked, false);
  success(transact(storage, { type: "body", fitting: "hoodScoop" }));
  assert.equal(undoWorkshop(storage, prior, opened).ok, false);
  const ticket = success(
    transact(storage, { type: "race", route: "strip", wager: 0 }),
  ).pending!;
  assert.equal(ticket.car.modelIndex, 0);
  assert.equal(ticket.car.fittings.hoodScoop, true);
  assert.equal(ticket.car.automatic, false);
});
test("an earlier saved car retains its tuning and gets stock equipment and bodywork", () => {
  const storage = new Store();
  success(transact(storage, buy));
  const key = "fuserod.garage.v1",
    state = JSON.parse(storage.getItem(key)!);
  for (const field of ["fuel", "paint", "workshop", "fittings"])
    delete state.fleet[0][field];
  for (const field of [
    "roadStarts",
    "canyonWins",
    "aqueductWins",
    "finalLeg",
    "qualified",
  ])
    delete state[field];
  state.fleet[0].engine = 1;
  storage.setItem(key, JSON.stringify(state));
  const c = activeCar(loadCampaign(storage))!;
  assert.equal(c.engine, 1);
  assert.equal(c.fuel, 40);
  assert.equal(c.paint, MODELS.kestrel.paint);
  assert.equal(c.workshop.wired, true);
  assert.equal(c.fittings.frontBumper, true);
});
test("fifteen labelled slots keep the previous save and the displaced active career", () => {
  const storage = new Store();
  success(transact(storage, { type: "name", driver: "Ada" }));
  const first = success(transact(storage, buy));
  success(saveSlot(storage, 15, false));
  assert.match(slotSummary(storage, 15).label, /Ada/);
  const painted = success(
    transact(storage, { type: "paint", paint: "#738bdd" }),
  );
  assert.equal(saveSlot(storage, 15, false).ok, false);
  success(saveSlot(storage, 15, true));
  assert.ok(slotSummary(storage, 15).backup);
  const tuned = success(transact(storage, { type: "upgrade", part: "engine" }));
  const restored = success(restoreSlot(storage, 15, "previous"));
  assert.equal(restored.cash, first.cash);
  assert.equal(activeCar(restored)!.paint, MODELS.kestrel.paint);
  assert.equal(success(restoreSlot(storage, 15, "recovery")).cash, tuned.cash);
  assert.equal(success(restoreSlot(storage, 15, "current")).cash, painted.cash);
  assert.equal(saveSlot(storage, 16, false).ok, false);
  const before = loadCampaign(storage);
  storage.setItem("fuserod.garage.slot.3", "broken");
  assert.equal(slotSummary(storage, 3).valid, false);
  assert.equal(restoreSlot(storage, 3, "current").ok, false);
  assert.deepEqual(loadCampaign(storage), before);
  assert.equal(saveSlot(storage, 3, true).ok, false);
  assert.equal(storage.getItem("fuserod.garage.slot.3"), "broken");
});
test("weekly seller and buyer counteroffers protect the same transactions used by the UI", () => {
  let s = freshCampaign();
  const price = dealerQuote(s.day, "kestrel");
  assert.ok(price < MODELS.kestrel.price);
  assert.equal(
    change(s, { type: "buy", model: "kestrel", offer: price - 5 }).ok,
    false,
  );
  s = success(change(s, { type: "buy", model: "kestrel", offer: price }));
  assert.equal(s.cash, 1100 - price);
  const buyback = dealerQuote(s.day, "kestrel", activeCar(s));
  assert.equal(
    change(s, { type: "sell", model: "kestrel", offer: buyback + 5 }).ok,
    false,
  );
  s = success(change(s, { type: "sell", model: "kestrel", offer: buyback }));
  assert.equal(s.cash, 1100 - price + buyback);
});
test("a heavily advantaged driver can renegotiate a declined title race down to a free run", () => {
  const base = success(
    change(
      { ...freshCampaign(), cash: 10000 },
      { type: "buy", model: "meteor" },
    ),
  );
  let s = success(change(base, { type: "upgrade", part: "engine" }));
  s = success(change(s, { type: "upgrade", part: "engine" }));
  const car = activeCar(s)!;
  assert.equal(rivalAccepts(s, car, 0, 0, true), false);
  assert.equal(
    change(s, { type: "race", route: "strip", wager: 0, pinkSlip: true }).ok,
    false,
  );
  assert.equal(change(s, { type: "race", route: "strip", wager: 0 }).ok, true);
});
test("speeding fines refund abandoned stakes, preserve titles, and end a season only for unpaid debt", () => {
  for (const [speed, fine] of [
    [50, 20],
    [51, 50],
    [81, 75],
  ] as const) {
    const store = new Store();
    success(transact(store, buy));
    const s = success(
      transact(store, { type: "race", route: "canyon", wager: 100 }),
    );
    const end = success(
      settleRace(store, s.pending!.id, { won: false, speedingMph: speed }),
    );
    assert.equal(end.cash, 400 - fine);
    assert.equal(end.jailed, false);
    assert.equal(end.fleet.length, 1);
  }
  let s = success(change({ ...freshCampaign(), cash: 720 }, buy));
  s = success(
    change(s, { type: "race", route: "canyon", wager: 0, pinkSlip: true }),
  );
  s = success(
    change(s, {
      type: "settle",
      id: s.pending!.id,
      won: false,
      damage: 0,
      speedingMph: 100,
    }),
  );
  assert.equal(s.jailed, true);
  assert.equal(s.cash, 0);
  assert.ok(finished(s));
  assert.equal(s.fleet.length, 1);
});
