import assert from "node:assert/strict";
import test from "node:test";
import { Window } from "happy-dom";
import { mountGarage } from "../src/garage/screen.js";
import {
  ACTIVE_SAVE,
  FINAL_DAY,
  loadCampaign,
  transact,
  type StoragePort,
} from "../src/garage/campaign.js";
function fixture(prepare?: (storage: StoragePort) => void) {
  const window = new Window(),
    doc = window.document as unknown as Document,
    host = doc.createElement("main");
  const storage = window.localStorage;
  assert.ok(transact(storage, { type: "buy", model: "kestrel" }).ok);
  prepare?.(storage);
  doc.body.append(host);
  const departures: string[] = [];
  const dispose = mountGarage(host, {
    storage,
    onRace() {},
    onCruise: (from) => departures.push(from),
  });
  const button = (key: string) => {
    const button = host.querySelector<HTMLButtonElement>(
      `[data-garage-key="${key}"]`,
    );
    assert.ok(button);
    return button;
  };
  const reason = () => {
    const id = button("cruise").getAttribute("aria-describedby");
    return id ? doc.getElementById(id)?.textContent : "";
  };
  return {
    host,
    doc,
    storage,
    departures,
    button,
    reason,
    close: async () => {
      dispose();
      await window.happyDOM.close();
    },
  };
}
test("the mounted garage lets a roadworthy driver leave and explains a workbench block", async () => {
  const ready = fixture();
  try {
    ready.button("cruise").click();
    assert.deepEqual(ready.departures, ["diner"]);
  } finally {
    await ready.close();
  }
  const blocked = fixture((storage) => {
    assert.ok(
      transact(storage, { type: "workbench", command: { type: "jack" } }).ok,
    );
  });
  try {
    assert.ok(blocked.button("cruise").disabled);
    assert.match(blocked.reason() ?? "", /lower the jack/i);
    blocked.button("cruise").click();
    assert.deepEqual(blocked.departures, []);
  } finally {
    await blocked.close();
  }
});
test("a pending race and a closed season also disable the mounted travel control in the logbook", async () => {
  const pending = fixture((storage) => {
    assert.ok(transact(storage, { type: "race", route: "strip", wager: 0 }).ok);
  });
  try {
    assert.ok(pending.button("cruise").disabled);
    assert.match(pending.reason() ?? "", /active race/);
    pending.button("cruise").click();
    assert.deepEqual(pending.departures, []);
  } finally {
    await pending.close();
  }
  const ended = fixture((storage) => {
    storage.setItem(
      ACTIVE_SAVE,
      JSON.stringify({ ...loadCampaign(storage), day: FINAL_DAY + 1 }),
    );
  });
  try {
    for (const step of ["end", "logbook"]) {
      if (step === "logbook") ended.button("open-logbook").click();
      assert.ok(ended.button("cruise").disabled);
      assert.match(ended.reason() ?? "", /season has ended/);
      ended.button("cruise").click();
    }
    assert.deepEqual(ended.departures, []);
  } finally {
    await ended.close();
  }
});
test("the last-car sale label and negotiable classifieds agree on an affordable replacement", async () => {
  const f = fixture((storage) => {
    storage.setItem(
      ACTIVE_SAVE,
      JSON.stringify({ ...loadCampaign(storage), cash: 250 }),
    );
  });
  try {
    f.button("Classifieds").click();
    assert.doesNotMatch(
      f.button("sell-kestrel").textContent ?? "",
      /ends season/,
    );
    f.button("sell-kestrel").click();
    assert.equal(loadCampaign(f.storage).cash, 600);
    assert.ok(f.button("kestrel").disabled);
    f.button("haggle-kestrel").click();
    const form = f.host.querySelector<HTMLFormElement>("form.frg-deal")!;
    form.querySelector("input")!.value = "560";
    form.requestSubmit();
    assert.equal(loadCampaign(f.storage).selected, "kestrel");
    assert.equal(loadCampaign(f.storage).cash, 40);
  } finally {
    await f.close();
  }
});
