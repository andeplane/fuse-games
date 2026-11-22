/**
 * The terminal client: a bots-only match with a throughput summary, or one seat played by hand. Everything it
 * touches outside the engine (the terminal, the clock) is handed in; `scripts/fuse-galaxy.ts` supplies the real ones.
 */
import { createEconomyBot } from "../bots/economy-bot.js";
import { DEFAULT_RULES } from "../engine/index.js";
import { USAGE, parseArgs, type Args } from "./args.js";
import { runBotMatch, ticksPerSecond, type Clock } from "./bot-match.js";
import { playSession, type Terminal } from "./play.js";
import { renderStandings } from "./render.js";

export interface Dependencies {
  readonly terminal: Terminal;
  readonly clock: Clock;
}

type BotArgs = Extract<Args, { mode: "bots" }>;

function runBots(args: BotArgs, { terminal, clock }: Dependencies): number {
  const { setup, rules } = args;
  const policy = createEconomyBot();
  let ticks = 0,
    milliseconds = 0,
    faithful = true;
  for (let match = 0; match < args.matches; match++) {
    const seed = args.seed + match;
    const result = runBotMatch({ seed, setup, rules, policy, clock });
    ticks += result.ticks;
    milliseconds += result.milliseconds;
    faithful &&= result.replayMatches;
    terminal.write(
      `Fuse Galaxy · seed ${seed} · ${setup.teams} teams of ${setup.teamSize} + ${setup.neutrals} neutral planets · rules v${rules.version}`,
    );
    terminal.write(renderStandings(result.world, rules));
    terminal.write(
      `Commands: ${result.commands} sent, ${result.rejected} refused\n` +
        `World hash: ${result.hash} · replay from the log ${result.replayMatches ? "matches" : "DOES NOT MATCH"}\n` +
        `Speed: ${result.ticks} ticks in ${result.milliseconds.toFixed(1)} ms = ${ticksPerSecond(result.ticks, result.milliseconds)} ticks/second`,
    );
  }
  if (args.matches > 1)
    terminal.write(
      `Total: ${args.matches} matches, ${ticks} ticks in ${milliseconds.toFixed(1)} ms = ${ticksPerSecond(ticks, milliseconds)} ticks/second`,
    );
  return faithful ? 0 : 1;
}

/** Runs the client and returns its exit code. */
export async function main(
  argv: readonly string[],
  dependencies: Dependencies,
): Promise<number> {
  const args = parseArgs(argv, DEFAULT_RULES);
  switch (args.mode) {
    case "help":
      dependencies.terminal.write(USAGE);
      return 0;
    case "error":
      dependencies.terminal.write(`${args.message}\n\n${USAGE}`);
      return 2;
    case "bots":
      return runBots(args, dependencies);
    case "play":
      await playSession({
        seed: args.seed,
        setup: args.setup,
        rules: args.rules,
        seat: args.seat,
        policy: createEconomyBot(),
        terminal: dependencies.terminal,
      });
      return 0;
  }
}
