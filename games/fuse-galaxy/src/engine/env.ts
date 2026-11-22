/**
 * The game as an environment: `reset` starts a match from a seed, `step` plays one tick from every seat's commands
 * and hands back each seat's view, its reward and whether the match is over. A terminal client, a bot match and a
 * learning agent all drive the engine through this.
 *
 * The environment also keeps the match's log: the seed, the setup and every command submitted, the bot-run neutral
 * planets' included. `replay` plays a log back through `applyTick` alone and arrives at the same world, hash for
 * hash, whatever the bots' code is by then.
 */
import { applyTick } from "./apply-tick.js";
import type { Command, UntrustedSubmission } from "./commands.js";
import { isList, isRecord, isWhole } from "./guards.js";
import type { Rules } from "./rules.js";
import { createWorld, parseSetup, type MatchSetup } from "./setup.js";
import { viewFor, type PlayerView } from "./view.js";
import type { World } from "./world.js";

/** Something that plays a planet: it reads the planet's view and answers with this tick's commands. */
export type Policy = (view: PlayerView, rules: Rules) => readonly Command[];

export interface EnvOptions {
  readonly rules: Rules;
  /** What plays the neutral planets. Without one they sit idle. */
  readonly neutralPolicy?: Policy;
}

export interface StepResult {
  /** How many ticks the match has run. */
  readonly tick: number;
  readonly done: boolean;
  /** Each seat's view, by seat id. */
  readonly views: readonly PlayerView[];
  /** Each seat's reward for the step, by seat id: how much its score changed. */
  readonly rewards: readonly number[];
}

export interface LogEntry {
  /** The tick the commands were applied on: 1 for the first step. */
  readonly tick: number;
  readonly submissions: readonly UntrustedSubmission[];
}

/** Everything needed to play a match again: where it started and what was submitted on each tick. */
export interface MatchLog {
  readonly rulesVersion: number;
  readonly seed: number;
  readonly setup: MatchSetup;
  /** How many ticks were played. */
  readonly ticks: number;
  /** The ticks on which anything was submitted, in order. */
  readonly entries: readonly LogEntry[];
}

export interface Env {
  /** Starts a new match. Throws a `RangeError` for a seed or a setup `createWorld` refuses. */
  reset(seed: number, setup: MatchSetup): StepResult;
  /**
   * Plays one tick. Commands are taken from seats only; a neutral planet's come from the neutral policy. Once the
   * match is done a step changes nothing and is not logged. Throws when `reset` has not been called.
   */
  step(commandsByPlayer: ReadonlyMap<number, readonly Command[]>): StepResult;
  world(): World;
  log(): MatchLog;
}

interface Match {
  readonly seed: number;
  readonly setup: MatchSetup;
  readonly seats: number;
  world: World;
  ticks: number;
  entries: LogEntry[];
}

export function createEnv(options: EnvOptions): Env {
  const { rules, neutralPolicy } = options;
  let match: Match | undefined;

  const current = (): Match => {
    if (!match) throw new Error("reset the environment before using it");
    return match;
  };

  const result = (now: Match, before: World): StepResult => ({
    tick: now.world.tick,
    done: now.world.phase === "ended",
    views: Array.from({ length: now.seats }, (_, seat) =>
      viewFor(now.world, seat, rules),
    ),
    rewards: Array.from(
      { length: now.seats },
      (_, seat) => now.world.planets[seat]!.score - before.planets[seat]!.score,
    ),
  });

  return {
    reset(seed, setup) {
      const world = createWorld(seed, setup, rules);
      match = {
        seed,
        setup: { ...setup },
        seats: setup.teams * setup.teamSize,
        world,
        ticks: 0,
        entries: [],
      };
      return result(match, world);
    },
    step(commandsByPlayer) {
      const now = current();
      const before = now.world;
      if (before.phase === "ended") return result(now, before);
      const submissions: UntrustedSubmission[] = [];
      for (const planet of before.planets) {
        const commands =
          planet.kind === "seat"
            ? commandsByPlayer.get(planet.id)
            : neutralPolicy?.(viewFor(before, planet.id, rules), rules);
        if (commands)
          for (const command of commands)
            submissions.push({ player: planet.id, command });
      }
      now.world = applyTick(before, submissions, rules);
      now.ticks += 1;
      if (submissions.length > 0)
        now.entries.push({ tick: now.ticks, submissions });
      return result(now, before);
    },
    world: () => current().world,
    log() {
      const now = current();
      return {
        rulesVersion: rules.version,
        seed: now.seed,
        setup: now.setup,
        ticks: now.ticks,
        entries: [...now.entries],
      };
    },
  };
}

/**
 * The world a logged match ended in, by applying its ticks again. Throws a `RangeError` for a log recorded under
 * other rules, longer than the rules let a match run, or whose start the rules refuse.
 */
export function replay(log: MatchLog, rules: Rules): World {
  if (log.rulesVersion !== rules.version)
    throw new RangeError(
      `the log was recorded under rules version ${log.rulesVersion}, not ${rules.version}`,
    );
  if (log.ticks > rules.match.tickLimit)
    throw new RangeError("the log is longer than a match can run");
  let world = createWorld(log.seed, log.setup, rules);
  let next = 0;
  for (let tick = 1; tick <= log.ticks; tick++) {
    const entry = log.entries[next];
    const logged = entry !== undefined && entry.tick === tick;
    if (logged) next += 1;
    world = applyTick(world, logged ? entry.submissions : [], rules);
  }
  return world;
}

function parseEntry(value: unknown): LogEntry | undefined {
  if (!isRecord(value) || !isWhole(value.tick)) return undefined;
  if (!isList(value.submissions)) return undefined;
  const submissions: UntrustedSubmission[] = [];
  for (const submission of value.submissions) {
    if (!isRecord(submission) || !isWhole(submission.player)) return undefined;
    submissions.push({
      player: submission.player,
      command: submission.command,
    });
  }
  return { tick: value.tick, submissions };
}

/**
 * Reads a match log from untrusted data, such as a saved file; undefined when it is not one. The commands inside
 * stay unread: `applyTick` checks each as it replays.
 */
export function parseMatchLog(value: unknown): MatchLog | undefined {
  if (!isRecord(value)) return undefined;
  const { rulesVersion, seed, ticks } = value;
  const setup = parseSetup(value.setup);
  if (!isWhole(rulesVersion) || !isWhole(seed) || !setup) return undefined;
  if (!isWhole(ticks) || ticks < 0 || !isList(value.entries)) return undefined;
  const entries: LogEntry[] = [];
  let last = 0;
  for (const raw of value.entries) {
    const entry = parseEntry(raw);
    if (!entry || entry.tick <= last || entry.tick > ticks) return undefined;
    last = entry.tick;
    entries.push(entry);
  }
  return { rulesVersion, seed, setup, ticks, entries };
}
