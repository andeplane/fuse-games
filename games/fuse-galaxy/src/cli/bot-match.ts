/**
 * A whole match between bots at full speed, timed. The clock is handed in, so the measurement is the caller's and
 * a test can supply its own time.
 */
import {
  createEnv,
  hashWorld,
  replay,
  type Command,
  type MatchSetup,
  type Policy,
  type Rules,
  type World,
} from "../engine/index.js";

export interface Clock {
  /** The time in milliseconds, from any fixed start. */
  now(): number;
}

export interface BotMatchOptions {
  readonly seed: number;
  readonly setup: MatchSetup;
  readonly rules: Rules;
  /** What plays every planet, seats and neutral planets alike. */
  readonly policy: Policy;
  readonly clock: Clock;
}

export interface BotMatchResult {
  readonly world: World;
  readonly hash: string;
  readonly ticks: number;
  /** How long the ticks took, bots included; the replay check is not counted. */
  readonly milliseconds: number;
  /** Commands the bots sent, and how many of them the engine refused. */
  readonly commands: number;
  readonly rejected: number;
  /** Whether playing the match's log back gave the same world. */
  readonly replayMatches: boolean;
}

export function runBotMatch(options: BotMatchOptions): BotMatchResult {
  const { seed, setup, rules, policy, clock } = options;
  const env = createEnv({ rules, neutralPolicy: policy });
  let rejected = 0;

  const started = clock.now();
  let step = env.reset(seed, setup);
  while (!step.done) {
    const commands = new Map<number, readonly Command[]>();
    for (const view of step.views) commands.set(view.self, policy(view, rules));
    step = env.step(commands);
    for (const event of env.world().events)
      if (event.type === "rejected") rejected += 1;
  }
  const milliseconds = clock.now() - started;

  const world = env.world();
  const log = env.log();
  const hash = hashWorld(world);
  return {
    world,
    hash,
    ticks: world.tick,
    milliseconds,
    commands: log.entries.reduce(
      (sum, entry) => sum + entry.submissions.length,
      0,
    ),
    rejected,
    replayMatches: hashWorld(replay(log, rules)) === hash,
  };
}

/** Ticks a second, as a whole number; 0 when no time was measured. */
export const ticksPerSecond = (ticks: number, milliseconds: number): number =>
  milliseconds > 0 ? Math.round((ticks * 1000) / milliseconds) : 0;
