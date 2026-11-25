import test from "node:test";
import assert from "node:assert/strict";
import { SETUP_2V2, SETUP_3V3 } from "../src/engine/index.js";
import { createEconomyBot } from "../src/bots/economy-bot.js";
import {
  runBotMatch,
  ticksPerSecond,
  type Clock,
} from "../src/cli/bot-match.js";
import { RULES } from "./support.js";

const wallClock: Clock = { now: () => performance.now() };

/**
 * The speed the engine is built for is thousands of ticks a second with bots
 * thinking on every one of them, so that self-play is cheap. The floor here is
 * a small fraction of what a laptop measures (`pnpm galaxy bots` prints it): it is
 * there to catch a tick that has become quadratic, not to time the machine.
 */
const FLOOR = 300;

test("whole bot matches run at thousands of ticks a second", (t) => {
  for (const [name, setup] of [
    ["2v2", SETUP_2V2],
    ["3v3", SETUP_3V3],
  ] as const) {
    // The first match pays for the compiler; the second is the one measured.
    runBotMatch({
      seed: 1,
      setup,
      rules: RULES,
      policy: createEconomyBot(),
      clock: wallClock,
    });
    const match = runBotMatch({
      seed: 2,
      setup,
      rules: RULES,
      policy: createEconomyBot(),
      clock: wallClock,
    });
    const speed = ticksPerSecond(match.ticks, match.milliseconds);
    t.diagnostic(
      `${name}: ${match.ticks} ticks, ${match.commands} commands in ${match.milliseconds.toFixed(1)} ms = ${speed} ticks/second`,
    );
    assert.equal(match.ticks, RULES.match.tickLimit);
    assert.equal(match.replayMatches, true);
    assert.ok(speed > FLOOR, `${name} ran at ${speed} ticks/second`);
  }
});
