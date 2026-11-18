import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buyOffroadUpgrade,
  campaignVariant,
  createOffroadDriver,
  firstCampaignRace,
  isCampaignIndex,
  isOffroadDriver,
  nextCampaignRace,
  offroadVehicleSetup,
  payOffroadDriver,
} from "../src/game/offroad/campaign.js";

test("the opening course, final sixteen-race loop and selected-start variants match the DOS sequence", () => {
  assert.equal(campaignVariant(0), 3);
  assert.equal(firstCampaignRace(3), 0);
  assert.equal(firstCampaignRace(0), 33);
  assert.equal(nextCampaignRace(42), 27);
  assert.deepEqual(
    Array.from({ length: 16 }, (_, n) => campaignVariant(n + 27)),
    [3, 6, 1, 5, 7, 4, 0, 2, 11, 14, 9, 13, 15, 12, 8, 10],
  );
  for (let variant = 0; variant < 16; variant++)
    assert.equal(campaignVariant(firstCampaignRace(variant)), variant);
  assert.throws(() => firstCampaignRace(16), RangeError);
  assert.throws(() => campaignVariant(-1), RangeError);
  assert.throws(() => nextCampaignRace(43), RangeError);
});

test("one game credit covers a shortfall and leaves the change in the wallet", () => {
  const fresh = createOffroadDriver();
  assert.equal(fresh.credits, 2);
  assert.equal(fresh.nitros, 25);
  const speed = buyOffroadUpgrade(fresh, "topSpeed")!;
  assert.deepEqual(speed, { ...fresh, credits: 1, cash: 10, topSpeed: 1 });
  const shocks = buyOffroadUpgrade(speed, "shocks")!;
  assert.deepEqual(shocks, { ...speed, cash: 4, shocks: 1 });
  assert.deepEqual(buyOffroadUpgrade(shocks, "acceleration"), {
    ...shocks,
    cash: 16,
    credits: 0,
    acceleration: 1,
  });
  assert.equal(buyOffroadUpgrade({ ...fresh, credits: 0 }, "tires"), null);
  assert.equal(buyOffroadUpgrade({ ...fresh, nitros: 99 }, "nitros"), null);
  assert.equal(buyOffroadUpgrade({ ...fresh, shocks: 5 }, "shocks"), null);
  assert.equal(fresh.cash, 0);
});

test("placement and moneybag rewards carry into the next shop with the DOS counter widths", () => {
  const driver = { ...createOffroadDriver(), cash: 9998, careerEarnings: 9999 };
  const paid = payOffroadDriver(driver, 2, 4, 12);
  assert.deepEqual(paid, {
    ...driver,
    cash: 11,
    careerEarnings: 12,
    nitros: 12,
  });
  assert.equal(payOffroadDriver(driver, 1, 95, 0).cash, 3);
  assert.equal(payOffroadDriver(driver, 5, 3, 0).cash, 1);
  assert.throws(() => payOffroadDriver(driver, 0, 0, 0), RangeError);
  assert.throws(() => payOffroadDriver(driver, 1, 100, 0), RangeError);
});

test("shock rebound, tire contact and gearing depend on their own purchased levels", () => {
  assert.deepEqual(offroadVehicleSetup(createOffroadDriver()), {
    drive: { turn: 1536, grip: 48, deceleration: 4, speedLimit: 134 },
    suspension: { rebound: 15360, contactTolerance: 2, topSpeed: 134 },
  });
  assert.deepEqual(offroadVehicleSetup({ shocks: 4, tires: 5, topSpeed: 2 }), {
    drive: { turn: 2176, grip: 72, deceleration: 8, speedLimit: 142 },
    suspension: { rebound: 10496, contactTolerance: 8, topSpeed: 142 },
  });
});

test("checkpoint validators bound cash, credits, upgrade grades and campaign indices", () => {
  const d = createOffroadDriver();
  assert.ok(isOffroadDriver(d));
  assert.ok(isOffroadDriver({ ...d, nitros: 99, cash: 9999, credits: 9 }));
  for (const invalid of [
    {},
    { ...d, cash: -0 },
    { ...d, tires: 6 },
    { ...d, shocks: 1.5 },
    { ...d, credits: 10 },
    { ...d, nitros: 100 },
  ])
    assert.equal(isOffroadDriver(invalid), false);
  assert.equal(isCampaignIndex(42), true);
  assert.equal(isCampaignIndex(43), false);
});
