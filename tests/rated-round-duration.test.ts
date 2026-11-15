import { strict as assert } from "node:assert";
import { test } from "node:test";
import { TICK_MS } from "../packages/fuse-netcode/src/clock.js";
import { diceRegistration } from "../games/dice/src/platform.js";
import { TICKS_PER_SECOND } from "../games/dice/src/game/rules.js";
import { elastoFuseRegistration } from "../games/elasto-fuse/src/platform.js";
import { STEPS_PER_SECOND as elastoHz } from "../games/elasto-fuse/src/engine/tuning.js";
import { fuseDriversRegistration } from "../games/fuse-drivers/src/platform.js";
import { TICK_RATE as driversHz } from "../games/fuse-drivers/src/game/sim/config.js";
import { fuseRiders } from "../games/fuse-riders/src/platform.js";
import { TICK_HZ as ridersHz } from "../games/fuse-riders/src/engine/tuning.js";
import { fuseVolleyRegistration } from "../games/fuse-volley/src/platform.js";
import { STEPS_PER_SECOND as volleyHz } from "../games/fuse-volley/src/engine/tuning.js";
import { fuseballRegistration } from "../games/fuseball/src/platform.js";
import { STEPS_PER_SECOND as ballHz } from "../games/fuseball/src/engine/tuning.js";
import { fusemaniaRegistration } from "../games/fusemania/src/platform.js";
import { killerFuseRegistration } from "../games/killer-fuse/src/platform.js";
import { TICK_HZ as killerHz } from "../games/killer-fuse/src/engine/tuning.js";

test("F-06 each rated game uses one second in its own tick units", () => {
  for (const [registration, hz] of [
    [diceRegistration, TICKS_PER_SECOND],
    [elastoFuseRegistration, elastoHz],
    [fuseDriversRegistration, driversHz],
    [fuseRiders, ridersHz],
    [fuseVolleyRegistration, volleyHz],
    [fuseballRegistration, ballHz],
    [fusemaniaRegistration, 1000 / TICK_MS],
    [killerFuseRegistration, killerHz],
  ] as const)
    assert.equal(registration.minRatedRoundTicks, hz, registration.id);
});
