import { test } from "node:test";
import assert from "node:assert/strict";
import { Window } from "happy-dom";
import { createPitShop } from "../src/app/pit-shop.js";
import {
  createOffroadDriver,
  type OffroadPurchase,
} from "../src/game/offroad/campaign.js";
import { resultBar } from "../src/app/result-report.js";

test("the speed shop quotes each upgrade, credit spend and caps, retaining each control after a wallet update", () => {
  const doc = new Window().document as unknown as Document;
  const purchases: OffroadPurchase[] = [];
  const shop = createPitShop(doc, (kind) => {
    purchases.push(kind);
    return true;
  });
  const wallet = {
    ...createOffroadDriver(),
    cash: 2,
    credits: 1,
    shocks: 5 as const,
  };
  shop.update(wallet);
  const controls = Array.from(shop.element.querySelectorAll("button"));
  assert.equal(controls.length, 5);
  assert.match(
    shop.element.querySelector('[role="status"]')!.textContent!,
    /\$20,000 · 1 credit/,
  );
  assert.match(controls[0]!.textContent!, /Nitro25\/99 bottles\$10,000$/);
  assert.ok(controls[1]!.disabled);
  assert.match(controls[1]!.textContent!, /Level 5\/5Full/);
  assert.match(controls[2]!.textContent!, /\$40,000 · uses 1 credit/);
  controls[2]!.click();
  assert.deepEqual(purchases, ["tires"]);
  shop.update({ ...wallet, cash: 0, credits: 0 });
  assert.equal(shop.element.querySelector("button"), controls[0]);
  assert.ok(controls.every((b) => b.disabled));
  assert.match(controls[0]!.textContent!, /insufficient funds/);
});

test("a non-host driver can open the speed shop while TV results are read-only", () => {
  const result = {
    title: "WINNER",
    track: "offroad-4",
    laps: 4,
    rows: [],
    winnerTruck: -1,
    host: false,
    waiting: "Waiting for the host",
  };
  assert.deepEqual(
    resultBar(result, true).actions.map((a) => a.id),
    ["shop"],
  );
  assert.deepEqual(resultBar(result, false).actions, []);
  assert.deepEqual(
    resultBar({ ...result, host: true }, true).actions.map((a) => a.id),
    ["shop", "lobby", "rematch"],
  );
});
